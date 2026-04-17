const ALLOWED_EXTS = new Set(['.pdf', '.doc', '.docx', '.txt', '.md']);

// i18n: progress step labels per language
const I18N = {
  kk: {
    ready:    'Файл талдауға дайын.',
    preparing:'Талдауға дайындалуда...',
    error:    'Қате шықты.',
    done:     'Аяқталды! ✓',
    starting: 'Талдау басталды...',
    btnAnalyze: '🔍 Шартты талдау',
    btnLoading: '⏳ Талданып жатыр...',
    steps: [
      { pct: 12, label: 'Файл серверге жіберілуде...' },
      { pct: 30, label: 'Құжат қауіпсіз тексерілуде...' },
      { pct: 52, label: 'OpenAI арқылы мәтін талдануда...' },
      { pct: 74, label: 'Тәуекелдер мен ескертулер дайындалуда...' },
      { pct: 90, label: 'Нәтиже интерфейске құрастырылуда...' },
    ],
  },
  ru: {
    ready:    'Файл готов к анализу.',
    preparing:'Подготовка к анализу...',
    error:    'Произошла ошибка.',
    done:     'Готово! ✓',
    starting: 'Анализ запущен...',
    btnAnalyze: '🔍 Анализировать договор',
    btnLoading: '⏳ Анализируется...',
    steps: [
      { pct: 12, label: 'Файл отправляется на сервер...' },
      { pct: 30, label: 'Документ проверяется безопасно...' },
      { pct: 52, label: 'OpenAI анализирует текст...' },
      { pct: 74, label: 'Выявление рисков и предупреждений...' },
      { pct: 90, label: 'Формируем результат...' },
    ],
  },
  en: {
    ready:    'File ready for analysis.',
    preparing:'Preparing for analysis...',
    error:    'An error occurred.',
    done:     'Done! ✓',
    starting: 'Analysis started...',
    btnAnalyze: '🔍 Analyse Contract',
    btnLoading: '⏳ Analysing...',
    steps: [
      { pct: 12, label: 'Uploading file to server...' },
      { pct: 30, label: 'Securely scanning document...' },
      { pct: 52, label: 'OpenAI is reading the text...' },
      { pct: 74, label: 'Detecting risks and warnings...' },
      { pct: 90, label: 'Building result...' },
    ],
  },
};

const state = {
  file: null,
  loading: false,
  progressTimer: null,
  language: 'kk',
};

const navbar = document.getElementById('navbar');
const hamburgerBtn = document.getElementById('hamburgerBtn');
const mobileMenu = document.getElementById('mobileMenu');
const revealEls = document.querySelectorAll('.reveal');

const fileInput = document.getElementById('fileInput');
const uploadBox = document.getElementById('uploadBox');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const analyzeBtn = document.getElementById('analyzeBtn');
const removeFileBtn = document.getElementById('removeFileBtn');
const progressBar = document.getElementById('progressBar');
const progressLabel = document.getElementById('progressLabel');
const errorBox = document.getElementById('errorBox');
const resetBtn = document.getElementById('resetBtn');

const langToggle = document.getElementById('langToggle');

const resultsSection = document.getElementById('results');
const resultCards = document.getElementById('resultCards');
const riskIndex = document.getElementById('riskIndex');
const overallSummary = document.getElementById('overallSummary');
const riskCount = document.getElementById('riskCount');
const warningCount = document.getElementById('warningCount');
const okCount = document.getElementById('okCount');
const recommendationList = document.getElementById('recommendationList');
const disclaimerText = document.getElementById('disclaimerText');

const contactForm = document.getElementById('contactForm');
const formSuccess = document.getElementById('formSuccess');

const severityMeta = {
  risk: { label: 'Тәуекел', icon: '🔴' },
  warning: { label: 'Ескерту', icon: '🟡' },
  ok: { label: 'Қалыпты', icon: '🟢' },
};

window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 20);
});

hamburgerBtn?.addEventListener('click', () => {
  mobileMenu.classList.toggle('open');
});

// Language selector
if (langToggle) {
  langToggle.addEventListener('click', (event) => {
    const btn = event.target.closest('.lang-btn');
    if (!btn || state.loading) return;
    const lang = btn.dataset.lang;
    if (!lang || lang === state.language) return;

    state.language = lang;
    langToggle.querySelectorAll('.lang-btn').forEach((b) =>
      b.classList.toggle('active', b === btn)
    );

    // Update button label and progress text to reflect new language
    const t = I18N[lang];
    analyzeBtn.textContent = state.file ? t.btnAnalyze : t.btnAnalyze;
    setProgress(0, t.preparing);
  });
}

for (const link of mobileMenu.querySelectorAll('a')) {
  link.addEventListener('click', () => mobileMenu.classList.remove('open'));
}

for (const btn of document.querySelectorAll('[data-scroll]')) {
  btn.addEventListener('click', () => {
    const target = document.querySelector(btn.dataset.scroll);
    if (target) {
      mobileMenu.classList.remove('open');
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
}

for (const link of document.querySelectorAll('.nav-links a, .mobile-menu a')) {
  link.addEventListener('click', (event) => {
    const href = link.getAttribute('href');
    if (!href || !href.startsWith('#')) return;
    const target = document.querySelector(href);
    if (!target) return;
    event.preventDefault();
    mobileMenu.classList.remove('open');
    target.scrollIntoView({ behavior: 'smooth' });
  });
}

if ('IntersectionObserver' in window && revealEls.length) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
      if (!entry.isIntersecting) return;
      setTimeout(() => entry.target.classList.add('visible'), index * 80);
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.15 });

  revealEls.forEach((el) => observer.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add('visible'));
}

fileInput.addEventListener('change', (event) => {
  const [file] = event.target.files;
  if (file) setFile(file);
});

removeFileBtn.addEventListener('click', () => {
  clearFile();
});

resetBtn.addEventListener('click', () => {
  clearFile();
  hideResults();
  document.getElementById('upload').scrollIntoView({ behavior: 'smooth' });
});

analyzeBtn.addEventListener('click', analyzeDocument);

['dragenter', 'dragover'].forEach((eventName) => {
  uploadBox.addEventListener(eventName, (event) => {
    event.preventDefault();
    uploadBox.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  uploadBox.addEventListener(eventName, (event) => {
    event.preventDefault();
    uploadBox.classList.remove('dragover');
  });
});

uploadBox.addEventListener('drop', (event) => {
  const [file] = event.dataTransfer.files;
  if (!file) return;
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    showError(`«${file.name}» — қолдау көрсетілмейтін формат. PDF, DOC, DOCX, TXT немесе MD жүктеңіз.`);
    return;
  }
  setFile(file);
});

contactForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = document.getElementById('formName').value.trim();
  const email = document.getElementById('formEmail').value.trim();
  const message = document.getElementById('formMsg').value.trim();

  if (!name || !email || !message) {
    alert('Барлық өрістерді толтырыңыз.');
    return;
  }

  contactForm.style.display = 'none';
  formSuccess.classList.add('visible');
});

resultsSection.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-rec-toggle]');
  if (!btn) return;

  const card = btn.closest('.result-card');
  const recommendation = card?.querySelector('.result-card-recommendation');
  if (!recommendation) return;

  const isVisible = recommendation.classList.toggle('visible');
  btn.textContent = isVisible ? 'Ұсынысты жасыру ↑' : 'Ұсыныс алу →';
});

function setFile(file) {
  state.file = file;
  fileName.textContent = file.name;
  fileSize.textContent = `${(file.size / 1024 / 1024).toFixed(2)} МБ`;
  fileInfo.classList.add('visible');
  analyzeBtn.disabled = false;
  analyzeBtn.textContent = I18N[state.language].btnAnalyze;
  setProgress(0, I18N[state.language].ready);
  hideError();
}

function clearFile() {
  state.file = null;
  fileInput.value = '';
  fileInfo.classList.remove('visible');
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = I18N[state.language].btnAnalyze;
  setProgress(0, I18N[state.language].preparing);
  hideError();
}

function setProgress(percent, label) {
  progressBar.style.width = `${percent}%`;
  progressLabel.textContent = label;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.add('visible');
}

function hideError() {
  errorBox.classList.remove('visible');
  errorBox.textContent = '';
}

function startProgressSimulation() {
  stopProgressSimulation();

  const { steps, starting } = I18N[state.language];
  let index = 0;
  setProgress(6, starting);

  state.progressTimer = setInterval(() => {
    if (index >= steps.length) {
      stopProgressSimulation();
      return;
    }
    setProgress(steps[index].pct, steps[index].label);
    index += 1;
  }, 900);
}

function stopProgressSimulation() {
  if (!state.progressTimer) return;
  clearInterval(state.progressTimer);
  state.progressTimer = null;
}

async function analyzeDocument() {
  if (!state.file || state.loading) return;

  const t = I18N[state.language];

  state.loading = true;
  hideError();
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = t.btnLoading;
  removeFileBtn.disabled = true;  // жүктеу кезінде файлды жоюға болмайды
  startProgressSimulation();

  const formData = new FormData();
  formData.append('file', state.file);
  formData.append('language', state.language);

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      body: formData,
    });

    // Алдымен JSON parse қателігін ұстаймыз: егер сервер HTML қайтарса (502 nginx)
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`Server returned an unexpected response (HTTP ${response.status}). Please try again.`);
    }

    if (!response.ok) {
      throw new Error(payload?.detail || 'Analysis failed.');
    }

    setProgress(100, t.done);
    renderResult(payload);
    showResults();
    resultsSection.scrollIntoView({ behavior: 'smooth' });
  } catch (error) {
    setProgress(0, t.error);
    showError(error.message || 'Unknown error.');
  } finally {
    stopProgressSimulation();
    state.loading = false;
    removeFileBtn.disabled = false;
    analyzeBtn.disabled = !state.file;
    analyzeBtn.textContent = t.btnAnalyze;
  }
}

function showResults() {
  resultsSection.classList.add('visible');
}

function hideResults() {
  resultsSection.classList.remove('visible');
  riskIndex.textContent = '—';
  overallSummary.textContent = 'Қазір нәтиже жоқ. Алдымен құжат жүктеңіз.';
  riskCount.textContent = '0';
  warningCount.textContent = '0';
  okCount.textContent = '0';
  disclaimerText.textContent = 'Бұл автоматты талдау, ресми заңгерлік қорытынды емес.';
  resultCards.innerHTML = '<div class="empty-state">AI нәтижелері осында карточка түрінде шығады.</div>';
  recommendationList.innerHTML = `
    <li>
      <span class="rec-num">1</span>
      Нақты ұсыныстар құжат талданған соң осында шығады.
    </li>
  `;
}

function renderResult(data) {
  riskIndex.textContent = Number(data.risk_index).toFixed(1);
  overallSummary.textContent = data.overall_summary;
  riskCount.textContent = data.summary?.risk_count ?? 0;
  warningCount.textContent = data.summary?.warning_count ?? 0;
  okCount.textContent = data.summary?.ok_count ?? 0;
  disclaimerText.textContent = data.disclaimer || 'Бұл автоматты талдау, ресми заңгерлік қорытынды емес.';

  renderItems(data.items || []);
  renderRecommendations(data.recommendations || []);
}

function renderItems(items) {
  resultCards.innerHTML = '';

  if (!items.length) {
    resultCards.innerHTML = '<div class="empty-state">Нәтиже табылмады.</div>';
    return;
  }

  items.forEach((item, index) => {
    const meta = severityMeta[item.severity] || severityMeta.warning;
    const card = document.createElement('article');
    card.className = `result-card ${item.severity}`;
    card.style.animationDelay = `${0.08 + index * 0.05}s`;
    card.innerHTML = `
      <div class="result-card-top">
        <span class="result-card-badge">${meta.icon} ${meta.label}</span>
        <div class="result-card-title">${escapeHtml(item.title || '')}</div>
      </div>
      <div class="result-card-body">${escapeHtml(item.description || '')}</div>
      <div class="result-card-footer">
        <span class="result-card-clause">§ ${escapeHtml(item.clause || 'Құжат мәтіні бойынша')}</span>
        <button class="result-card-action" type="button" data-rec-toggle>Ұсыныс алу →</button>
      </div>
      <div class="result-card-recommendation">${escapeHtml(item.recommendation || 'Нақты ұсыныс берілмеді.')}</div>
    `;
    resultCards.appendChild(card);
  });
}

function renderRecommendations(recommendations) {
  recommendationList.innerHTML = '';

  if (!recommendations.length) {
    recommendationList.innerHTML = `
      <li>
        <span class="rec-num">1</span>
        Ұсыныстар жоқ.
      </li>
    `;
    return;
  }

  recommendations.forEach((item, index) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="rec-num">${index + 1}</span>${escapeHtml(item)}`;
    recommendationList.appendChild(li);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
