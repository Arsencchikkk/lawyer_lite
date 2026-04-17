import os
import tempfile
from pathlib import Path
from typing import Dict, List, Literal, Optional, Tuple

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAI
from pydantic import BaseModel, Field
import uvicorn


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".txt", ".md"}
SUPPORTED_LANGUAGES = {"kk", "ru", "en"}

load_dotenv(BASE_DIR / ".env")

app = FastAPI(title="Шартты Тексер", version="1.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class AnalysisItem(BaseModel):
    severity: Literal["risk", "warning", "ok"] = Field(
        description="Severity level"
    )
    title: str = Field(description="Short title")
    description: str = Field(description="User-friendly analysis")
    clause: str = Field(description="Clause or section number")
    recommendation: str = Field(description="Actionable recommendation")


class AnalysisSummary(BaseModel):
    risk_count: int = Field(ge=0)
    warning_count: int = Field(ge=0)
    ok_count: int = Field(ge=0)


class ContractAnalysisResult(BaseModel):
    risk_index: float = Field(ge=0, le=10)
    overall_summary: str = Field(description="1-2 sentence document summary")
    disclaimer: str = Field(description="Short disclaimer: not legal advice")
    summary: AnalysisSummary
    items: List[AnalysisItem] = Field(min_length=3, max_length=12)
    recommendations: List[str] = Field(min_length=3, max_length=8)


# ---------------------------------------------------------------------------
# Prompts — three languages
# ---------------------------------------------------------------------------

_PROMPTS: Dict[str, Tuple[str, str]] = {
    "kk": (
        # system
        """
Сен келісімшарттарды талдайтын AI заңгер-көмекшісің.

Міндет:
1. Пайдаланушы жүктеген құжатты толық оқы.
2. Пайдаланушыға түсінікті, іскер стильде, ҚАЗАҚ ТІЛІНДЕ жауап бер.
3. Нәтижені тек берілген құрылымға сай толтыр.
4. Заңды тәуекелдерді, күмәнді тармақтарды және қалыпты тармақтарды бөл.
5. Тәуекел индексін 0-ден 10-ға дейін қой:
   - 0-3: төмен
   - 3.1-6: орташа
   - 6.1-10: жоғары
6. items ішінде нақты тармақтарды көрсет. Егер бөлім нөмірі жоқ болса,
   clause орнына "Құжат мәтіні бойынша" деп жаз.
7. recommendation жолдары нақты, әрекетке бағытталған болсын.
8. Ешқашан ойдан құжат үзіндісін қоспа.
9. Егер құжат келісімшарт болмаса, overall_summary ішінде ескерт.
10. disclaimer: "Бұл автоматты талдау, ресми заңгерлік қорытынды емес."

severity ережесі:
- risk: біржақты бұзу, шексіз жауапкершілік, айыппұл анық еместігі,
  IP толық беру, төлем/мерзім/юрисдикция тәуекелі, дербес дерек тәуекелі.
- warning: толық емес, түсініксіз немесе нақтылауды қажет ететін тармақ.
- ok: стандартты және теңгерімді тармақ.
        """.strip(),
        # user
        """
Осы құжатты талда.

Нәтиже:
- Тәуекел индексі (0–10).
- risk / warning / ok санаттары бойынша санақ.
- Ең маңызды пункттер.
- Қысқа ұсыныстар тізімі.

Жауап тек қазақ тілінде. Frontend карточкасына сыйымды, қысқа жаз.
        """.strip(),
    ),

    "ru": (
        # system
        """
Ты AI-помощник юриста, специализирующийся на анализе договоров.

Задача:
1. Полностью прочитай загруженный документ.
2. Отвечай на деловом, понятном РУССКОМ ЯЗЫКЕ.
3. Заполни результат строго по заданной структуре.
4. Разделяй юридические риски, спорные пункты и нормальные положения.
5. Индекс риска от 0 до 10:
   - 0-3: низкий
   - 3.1-6: средний
   - 6.1-10: высокий
6. В items указывай конкретные пункты договора. Если номер раздела не указан,
   в поле clause пиши "По тексту документа".
7. recommendation — конкретные, ориентированные на действия рекомендации.
8. Никогда не придумывай цитаты из документа.
9. Если документ не является договором, всё равно заполни структуру,
   но укажи это в overall_summary.
10. disclaimer: "Это автоматический анализ, не является официальной юридической консультацией."

Правила severity:
- risk: одностороннее расторжение, неограниченная ответственность, неясные штрафы,
  полная передача IP, риски по оплате/срокам/юрисдикции, персональные данные.
- warning: неполный, неоднозначный или требующий уточнения пункт.
- ok: стандартный и сбалансированный пункт.
        """.strip(),
        # user
        """
Проанализируй этот документ.

Нужен результат:
- Индекс риска (0–10).
- Подсчёт по категориям: risk / warning / ok.
- Наиболее важные пункты.
- Краткий список рекомендаций.

Отвечай только на русском языке. Пиши кратко — текст должен помещаться в карточку.
        """.strip(),
    ),

    "en": (
        # system
        """
You are an AI legal assistant specializing in contract analysis.

Task:
1. Read the uploaded document in full.
2. Respond in clear, professional ENGLISH.
3. Fill in the result strictly according to the given structure.
4. Separate legal risks, questionable clauses, and standard provisions.
5. Risk index from 0 to 10:
   - 0-3: low
   - 3.1-6: medium
   - 6.1-10: high
6. In items, reference specific clauses. If no section number exists,
   use "Per document text" in the clause field.
7. recommendation should be concrete and action-oriented.
8. Never fabricate quotes from the document.
9. If the document is not a contract, still fill the structure but note it in overall_summary.
10. disclaimer: "This is an automated analysis, not official legal advice."

Severity rules:
- risk: unilateral termination, unlimited liability, unclear penalties,
  full IP transfer, payment/deadline/jurisdiction risks, personal data risks.
- warning: incomplete, ambiguous, or needs clarification.
- ok: standard and balanced clause.
        """.strip(),
        # user
        """
Analyze this document.

I need:
- Risk index (0–10).
- Count by category: risk / warning / ok.
- Most important clauses.
- Short list of recommendations.

Respond only in English. Keep it concise — text should fit in a card.
        """.strip(),
    ),
}


def get_prompts(language: str) -> Tuple[str, str]:
    """Return (system_prompt, user_prompt) for the given language code."""
    return _PROMPTS.get(language, _PROMPTS["kk"])


# ---------------------------------------------------------------------------
# OpenAI client
# ---------------------------------------------------------------------------

def get_client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY not found. Please set it in your .env file.",
        )
    # timeout: 120s — prevents hanging on Render cold-start
    return OpenAI(api_key=api_key, timeout=120.0)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Core analysis logic
# ---------------------------------------------------------------------------

async def read_upload_bytes(file: UploadFile) -> bytes:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The file is empty.")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File size must not exceed 20 MB.")
    return content


def _analyze_contract_sync(
    content: bytes, filename: str, language: str
) -> ContractAnalysisResult:
    extension = Path(filename).suffix.lower()
    client = get_client()
    temp_path: Optional[str] = None
    uploaded_file_id: Optional[str] = None

    system_prompt, user_prompt = get_prompts(language)

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=extension) as tmp:
            tmp.write(content)
            temp_path = tmp.name

        with open(temp_path, "rb") as file_handle:
            uploaded = client.files.create(file=file_handle, purpose="user_data")
            uploaded_file_id = uploaded.id

        response = client.responses.parse(
            model=os.getenv("OPENAI_MODEL", "gpt-4o"),
            input=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "input_file", "file_id": uploaded_file_id},
                        {"type": "input_text", "text": user_prompt},
                    ],
                },
            ],
            text_format=ContractAnalysisResult,
        )

        parsed = response.output_parsed
        if parsed is None:
            raise HTTPException(
                status_code=502,
                detail="The AI could not return a structured response. Please try again.",
            )

        return parsed

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Analysis error: {str(exc)}",
        ) from exc
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
        if uploaded_file_id:
            try:
                client.files.delete(uploaded_file_id)
            except Exception:
                pass


@app.post("/api/analyze", response_model=ContractAnalysisResult)
async def analyze_contract(
    file: UploadFile = File(...),
    language: str = Form("kk"),
) -> ContractAnalysisResult:
    # Validate language
    if language not in SUPPORTED_LANGUAGES:
        language = "kk"

    # Validate filename
    filename = (file.filename or "").strip()
    if not filename:
        raise HTTPException(status_code=400, detail="File name is required.")

    extension = Path(filename).suffix.lower()
    if not extension:
        raise HTTPException(
            status_code=400,
            detail="Could not determine file extension. Please upload PDF, DOC, DOCX, TXT or MD.",
        )

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Only PDF, DOC, DOCX, TXT or MD files are supported.",
        )

    content = await read_upload_bytes(file)
    return await run_in_threadpool(_analyze_contract_sync, content, filename, language)


if __name__ == "__main__":
    # reload=True is for dev only; Render runs a production server
    debug = os.getenv("ENV", "production").lower() == "development"
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=debug,
    )
