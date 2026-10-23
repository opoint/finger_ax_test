const BONUS_RATE = 1.5;      // 선호 브랜드 가산 배율 (미확정 초안)
const LOW_TRUST_PHOTOS = 20; // 유효 사진 20장 미만이면 신뢰도 낮음 (초안)
const DEFAULT_CENTER = [37.6584, 126.832]; // 기본 위치: 고양시 일산동구 일대

let brands = {};
let result = null;
let lastRanks = null;          // 직전 화면의 업체별 순위 (변동 표시용)
const deltas = new Map();      // 업체별 마지막 변동 표시 (▲, ▼, NEW)
const preferred = new Set();

// ---------- 1. 지도와 반경 ----------
const map = L.map('map').setView(DEFAULT_CENTER, 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const marker = L.marker(DEFAULT_CENTER, {
  draggable: true,
  icon: L.divIcon({ className: 'me-pin', iconSize: [18, 18] })
}).addTo(map).bindTooltip('내 위치', { direction: 'top', offset: [0, -10] });
const circle = L.circle(DEFAULT_CENTER, { radius: 1000, weight: 1.5, fillOpacity: 0.06 }).addTo(map);
const gymLayer = L.layerGroup().addTo(map);
L.DomEvent.disableClickPropagation(document.querySelector('.brand-panel'));
L.DomEvent.disableScrollPropagation(document.querySelector('.brand-panel'));

const radiusInput = document.getElementById('radius');
const radiusOut = document.getElementById('radius-out');
const coordText = document.getElementById('coord');

function updateArea() {
  const km = Number(radiusInput.value);
  const pos = marker.getLatLng();
  circle.setLatLng(pos);
  circle.setRadius(km * 1000);
  radiusOut.textContent = km.toFixed(1) + 'km';
  const pct = (km - radiusInput.min) / (radiusInput.max - radiusInput.min) * 100;
  radiusInput.style.setProperty('--fill', pct + '%');
  coordText.textContent = `내 위치 ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
  if (result) { renderBrands(); render(); }
}
marker.on('drag', updateArea);
map.on('click', e => { marker.setLatLng(e.latlng); updateArea(); });
radiusInput.addEventListener('input', updateArea);

// ---------- 2. 순위 계산 ----------
function brandScore(name) {
  return brands[name] ?? brands['미상'];
}

function scoreGym(gym, usePreferred) {
  return gym.models.reduce((sum, m) => {
    const base = brandScore(m.brand);
    return sum + (usePreferred && preferred.has(m.brand) ? base * BONUS_RATE : base);
  }, 0);
}

function gymsInRange() {
  const center = marker.getLatLng();
  const meters = Number(radiusInput.value) * 1000;
  return result.gyms.filter(g => map.distance(center, [g.lat, g.lng]) <= meters);
}

function rankGyms() {
  const usePreferred = preferred.size > 0;
  const rows = gymsInRange()
    .map(g => ({ ...g, score: scoreGym(g, usePreferred), modelCount: g.models.length }))
    .sort((a, b) => b.score - a.score || b.modelCount - a.modelCount);
  let rank = 0, prevKey = null;
  rows.forEach((g, i) => {
    const key = g.score + '|' + g.modelCount;
    if (key !== prevKey) rank = i + 1;
    prevKey = key;
    g.rank = rank;
  });
  return rows;
}

// ---------- 3. 화면 ----------
function deltaBadge(d) {
  if (!d) return '';
  if (d.type === 'new') return '<span class="delta new">NEW</span>';
  return d.diff > 0
    ? `<span class="delta up">▲${d.diff}</span>`
    : `<span class="delta down">▼${-d.diff}</span>`;
}

function render() {
  const rows = rankGyms();
  const changed = new Set();

  if (lastRanks) {
    rows.forEach(g => {
      const before = lastRanks.get(g.name);
      if (before === undefined) {
        deltas.set(g.name, { type: 'new' });
        changed.add(g.name);
      } else if (before !== g.rank) {
        deltas.set(g.name, { type: 'move', diff: before - g.rank });
        changed.add(g.name);
      }
    });
  }
  // 범위 밖으로 나간 업체의 표시는 지운다
  [...deltas.keys()].forEach(name => { if (!rows.some(g => g.name === name)) deltas.delete(name); });
  lastRanks = new Map(rows.map(g => [g.name, g.rank]));

  gymLayer.clearLayers();
  const body = document.getElementById('rank-body');
  body.innerHTML = '';

  rows.forEach(g => {
    const topBrands = [...new Set(g.models.map(m => m.brand))]
      .sort((a, b) => brandScore(b) - brandScore(a)).slice(0, 3).join(', ');
    const low = g.validPhotos < LOW_TRUST_PHOTOS;
    const isChanged = changed.has(g.name);
    const isFirst = g.rank === 1;

    const tr = document.createElement('tr');
    if (isFirst) tr.classList.add('first');
    if (isChanged) tr.classList.add('flash');
    tr.innerHTML = `<td class="rank-cell"><span class="rank-num">${g.rank}</span>${deltaBadge(deltas.get(g.name))}</td>`
      + `<td>${g.name}</td><td>${Math.round(g.score * 10) / 10}</td>`
      + `<td>${g.modelCount}</td><td>${g.validPhotos}</td><td>${topBrands}</td>`
      + `<td class="${low ? 'low' : ''}">${low ? '낮음' : '보통'}</td>`;
    body.appendChild(tr);

    const cls = ['gym-pin'];
    if (isFirst) cls.push('first');
    if (isChanged) cls.push(deltas.get(g.name)?.type === 'new' ? 'pop' : 'pulse');
    L.marker([g.lat, g.lng], {
      icon: L.divIcon({ className: cls.join(' '), html: `<span>${g.rank}</span>`, iconSize: [28, 28] }),
      zIndexOffset: 1000 - g.rank
    })
      .bindTooltip(g.name, { direction: 'top', offset: [0, -16], className: 'gym-name' })
      .addTo(gymLayer);
  });

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty">반경 안에 분석된 헬스장이 없습니다. 반경을 넓히거나 내 위치를 옮겨 보세요.</td></tr>';
  }
}

function renderBrands() {
  const found = [...new Set(gymsInRange().flatMap(g => g.models.map(m => m.brand)))]
    .sort((a, b) => brandScore(b) - brandScore(a));
  const box = document.getElementById('brand-list');
  const key = found.join('|');
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = '';
  found.forEach(name => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = name;
    cb.checked = preferred.has(name);
    cb.addEventListener('change', () => {
      cb.checked ? preferred.add(name) : preferred.delete(name);
      render();
    });
    label.append(cb, name);
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
  updateArea();
});
updateArea();
