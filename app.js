const BONUS_RATE = 1.5;      // 선호 브랜드 가산 배율 (미확정 초안)
const LOW_TRUST_PHOTOS = 20; // 유효 사진 20장 미만이면 신뢰도 낮음 (초안)
const DEFAULT_CENTER = [37.6584, 126.832]; // 기본 위치: 고양시 일산동구 일대

let brands = {};
let result = null;
const preferred = new Set();

// ---------- 1. 지도와 반경 ----------
const map = L.map('map').setView(DEFAULT_CENTER, 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const marker = L.marker(DEFAULT_CENTER, { draggable: true }).addTo(map);
const circle = L.circle(DEFAULT_CENTER, { radius: 1000 }).addTo(map);
const radiusInput = document.getElementById('radius');
const radiusOut = document.getElementById('radius-out');
const coordText = document.getElementById('coord');

function updateArea() {
  const km = Number(radiusInput.value);
  const pos = marker.getLatLng();
  circle.setLatLng(pos);
  circle.setRadius(km * 1000);
  radiusOut.textContent = km.toFixed(1) + 'km';
  coordText.textContent = `중심 좌표 ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
}
marker.on('drag', updateArea);
radiusInput.addEventListener('input', updateArea);
updateArea();

document.getElementById('copy-btn').addEventListener('click', async () => {
  const pos = marker.getLatLng();
  const km = Number(radiusInput.value).toFixed(1);
  const text = `/gym-equipment-ranking 중심 좌표 ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)} 반경 ${km}km 헬스장 기구 투자 순위 분석해줘`;
  const msg = document.getElementById('copy-msg');
  try {
    await navigator.clipboard.writeText(text);
    msg.textContent = '복사했습니다. Claude 대화에 붙여넣으세요.';
  } catch (e) {
    msg.textContent = text;
  }
});

// ---------- 2. 결과 계산 ----------
function brandScore(name) {
  return brands[name] ?? brands['미상'];
}

function scoreGym(gym, usePreferred) {
  return gym.models.reduce((sum, m) => {
    const base = brandScore(m.brand);
    return sum + (usePreferred && preferred.has(m.brand) ? base * BONUS_RATE : base);
  }, 0);
}

function render() {
  const usePreferred = preferred.size > 0;
  const rows = result.gyms
    .map(g => ({ ...g, score: scoreGym(g, usePreferred), modelCount: g.models.length }))
    .sort((a, b) => b.score - a.score || b.modelCount - a.modelCount);

  const body = document.getElementById('rank-body');
  body.innerHTML = '';
  let rank = 0, prev = null;
  rows.forEach((g, i) => {
    const key = g.score + '|' + g.modelCount;
    if (key !== prev) rank = i + 1;
    prev = key;
    const topBrands = [...new Set(g.models.map(m => m.brand))]
      .sort((a, b) => brandScore(b) - brandScore(a)).slice(0, 3).join(', ');
    const low = g.validPhotos < LOW_TRUST_PHOTOS;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${rank}</td><td>${g.name}</td><td>${Math.round(g.score * 10) / 10}</td>`
      + `<td>${g.modelCount}</td><td>${g.validPhotos}</td><td>${topBrands}</td>`
      + `<td class="${low ? 'low' : ''}">${low ? '낮음' : '보통'}</td>`;
    body.appendChild(tr);
  });

  document.getElementById('result-meta').textContent =
    `${result.label} · 중심 ${result.center.join(', ')} · 반경 ${result.radiusKm}km · ${usePreferred ? '선호 브랜드 적용 순위' : '기본 순위'}`;
}

function renderBrands() {
  const found = [...new Set(result.gyms.flatMap(g => g.models.map(m => m.brand)))]
    .sort((a, b) => brandScore(b) - brandScore(a));
  const box = document.getElementById('brand-list');
  box.innerHTML = '';
  found.forEach(name => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = name;
    cb.addEventListener('change', () => {
      cb.checked ? preferred.add(name) : preferred.delete(name);
      render();
    });
    label.append(cb, `${name} (${brandScore(name)})`);
    box.appendChild(label);
  });
}

document.getElementById('reset-btn').addEventListener('click', () => {
  preferred.clear();
  document.querySelectorAll('#brand-list input').forEach(cb => { cb.checked = false; });
  render();
});

document.getElementById('bonus-rate').textContent = BONUS_RATE;

Promise.all([
  fetch('data/brands.json').then(r => r.json()),
  fetch('data/result.json').then(r => r.json())
]).then(([b, r]) => {
  brands = b;
  result = r;
  document.getElementById('excluded').innerHTML =
    r.excluded.map(e => `<li>제외: ${e.name} (${e.reason})</li>`).join('');
  renderBrands();
  render();
});
