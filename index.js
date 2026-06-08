/* ════════════════════════════════════════════════════════════════════════════
   SMARTROUTE VIETNAM — Vanilla JS  (v6.2 - Expanded Tourism & Zoom Logic)
════════════════════════════════════════════════════════════════════════════ */
'use strict';

/* ────────────────────────────────────────────────────────────────────────────
   §1  CONSTANTS & WMO WEATHER CODE TABLE
──────────────────────────────────────────────────────────────────────────── */
const WMO = {
  0: {v:"Quang đãng",       e:"☀️", s:0}, 1: {v:"Chủ yếu quang",    e:"🌤️",s:0},
  2: {v:"Có mây từng phần", e:"⛅", s:1}, 3: {v:"Nhiều mây",        e:"☁️", s:1},
  45:{v:"Sương mù",         e:"🌫️",s:2}, 48:{v:"Sương mù dày",     e:"🌫️",s:3},
  51:{v:"Mưa phùn nhẹ",     e:"🌦️",s:1}, 53:{v:"Mưa phùn vừa",     e:"🌦️",s:2},
  55:{v:"Mưa phùn nặng",    e:"🌧️",s:3}, 61:{v:"Mưa nhẹ",          e:"🌧️",s:2},
  63:{v:"Mưa vừa",          e:"🌧️",s:3}, 65:{v:"Mưa to",           e:"🌧️",s:4},
  71:{v:"Tuyết nhẹ",        e:"🌨️",s:2}, 73:{v:"Tuyết vừa",        e:"❄️", s:3},
  75:{v:"Tuyết dày",        e:"❄️", s:4}, 77:{v:"Hạt tuyết",        e:"🌨️",s:2},
  80:{v:"Mưa rào nhẹ",      e:"🌦️",s:2}, 81:{v:"Mưa rào vừa",      e:"🌧️",s:3},
  82:{v:"Mưa rào mạnh",     e:"🌧️",s:4}, 85:{v:"Mưa tuyết nhẹ",    e:"🌨️",s:3},
  86:{v:"Mưa tuyết nặng",   e:"❄️", s:4}, 95:{v:"Dông bão",         e:"⛈️", s:5},
  96:{v:"Dông + mưa đá",    e:"⛈️", s:5}, 99:{v:"Dông cực mạnh",    e:"⛈️", s:5},
};
function wmo(code){ return WMO[code] || WMO[3]; }
const SEVERE     = new Set([65,75,82,86,95,96,99]);
const W_PENALTY  = [0, 3, 10, 22, 45, 90];
const SEV_COLORS = ['var(--jade)','#84cc16','#eab308','#f97316','#ef4444','#8b5cf6'];

/* ────────────────────────────────────────────────────────────────────────────
   §2  UTILITY FUNCTIONS
──────────────────────────────────────────────────────────────────────────── */
function extractWaypoints(coords, n=8){
  if(!coords||!coords.length) return [];
  if(coords.length<=n) return coords.map(c=>({lat:c[1],lon:c[0]}));
  const step=(coords.length-1)/(n-1), pts=[];
  for(let i=0;i<n;i++){ const c=coords[Math.min(Math.round(i*step),coords.length-1)]; pts.push({lat:c[1],lon:c[0]}); }
  return pts;
}

function hourIdx(times, dateStr, hour){
  if(!times||!times.length) return -1;
  return times.findIndex(t=>t===`${dateStr}T${String(hour).padStart(2,'0')}:00`);
}

function calcRouteWeight(distKm, weatherArr, hIdxArr){
  const RISK=1.5; let pen=0;
  weatherArr.forEach((wd,i)=>{
    const hi=hIdxArr[i];
    if(hi === -1 || hi === undefined) return;
    if(!wd||!wd.hourly) return;
    const code=wd.hourly.weathercode?.[hi]||0, rain=wd.hourly.precipitation_probability?.[hi]||0;
    const temp=wd.hourly.temperature_2m?.[hi]||26, wind=wd.hourly.windspeed_10m?.[hi]||0;
    pen+=W_PENALTY[wmo(code).s]*(1+rain/100);
    if(temp>=35) pen+=25;
    if(wind>70) pen+=20; else if(wind>45) pen+=8;
  });
  return distKm+pen*RISK;
}

function todayStr(){ return new Date().toISOString().slice(0,10); }
function addDays(dateStr, n){ const d=new Date(dateStr+'T12:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
function fmtDate(dateStr, opts){ try{ return new Date(dateStr+'T12:00:00').toLocaleDateString('vi-VN', opts||{day:'2-digit',month:'2-digit'}); }catch(e){ return dateStr; } }
function dayVN(dateStr){ return ['CN','T2','T3','T4','T5','T6','T7'][new Date(dateStr+'T12:00:00').getDay()]; }

/* ────────────────────────────────────────────────────────────────────────────
   §3  OPEN-METEO WEATHER API
──────────────────────────────────────────────────────────────────────────── */
const _wxCache=new Map();
async function fetchWeather(lat, lon){
  const key=`${lat.toFixed(3)},${lon.toFixed(3)}`;
  if(_wxCache.has(key)) return _wxCache.get(key);
  try{ const raw=sessionStorage.getItem('wx_'+key); if(raw){ const c=JSON.parse(raw); if(Date.now()-c._ts<3600000){ _wxCache.set(key,c); return c; } } }catch(_){}
  const url=`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}&hourly=temperature_2m,apparent_temperature,precipitation_probability,weathercode,windspeed_10m,precipitation&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max,sunrise,sunset&forecast_days=16&timezone=Asia%2FBangkok`;
  const r=await fetch(url); if(!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  const data=await r.json(); data._ts=Date.now(); _wxCache.set(key,data);
  try{ sessionStorage.setItem('wx_'+key,JSON.stringify(data)); }catch(_){} return data;
}

function getDays(wx){
  if(!wx||!wx.daily||!wx.daily.time) return []; const d=wx.daily;
  return d.time.map((date,i)=>({ date, code:d.weathercode?.[i]||0, hi:d.temperature_2m_max?.[i]||28, lo:d.temperature_2m_min?.[i]||22, rain:d.precipitation_probability_max?.[i]||0, wind:d.windspeed_10m_max?.[i]||0 }));
}

function getHourlySlice(wx, dateStr){
  if(!wx||!wx.hourly||!wx.hourly.time) return null;
  const h=wx.hourly, out={labels:[],temp:[],rain:[],wind:[],code:[]};
  for(let i=0;i<h.time.length;i++){
    if(h.time[i].startsWith(dateStr)){ out.labels.push(h.time[i].slice(11,16)); out.temp.push(h.temperature_2m?.[i]??null); out.rain.push(h.precipitation_probability?.[i]??0); out.wind.push(h.windspeed_10m?.[i]??0); out.code.push(h.weathercode?.[i]??0); }
  }
  return out.labels.length ? out : null;
}

/* ────────────────────────────────────────────────────────────────────────────
   §4  OSRM ROUTING API
──────────────────────────────────────────────────────────────────────────── */
async function fetchOSRM(coordsList){
  let pCoords = [];
  for (let i = 0; i < coordsList.length; i++) {
    pCoords.push(coordsList[i]);
    if (i < coordsList.length - 1) {
      const c1 = coordsList[i], c2 = coordsList[i+1];
      const latMin = Math.min(c1.lat, c2.lat), latMax = Math.max(c1.lat, c2.lat);
      const isNorthbound = c2.lat > c1.lat; 
      const phuYen = {lat: 13.0882, lon: 109.0928}, daNang = {lat: 16.0544, lon: 108.2022};

      if (latMin <= 12 && latMax >= 18) { if(isNorthbound) pCoords.push(phuYen, daNang); else pCoords.push(daNang, phuYen); }
      else if (latMin <= 12 && latMax >= 15 && latMax < 18) pCoords.push(phuYen);
      else if (latMin > 12 && latMin <= 15 && latMax >= 18) pCoords.push(daNang);
    }
  }

  const pts = pCoords.map(c => `${c.lon},${c.lat}`).join(';');
  const vehicle = document.getElementById('pl-vehicle')?.value || 'car';
  const profile = (vehicle === 'scooter') ? 'bicycle' : 'driving';
  const url = `https://router.project-osrm.org/route/v1/${profile}/${pts}?overview=full&geometries=geojson`;
  
  const r = await fetch(url); if(!r.ok) throw new Error(`OSRM ${r.status}`);
  const d = await r.json(); if(d.code !== 'Ok') throw new Error('OSRM: Không tìm được tuyến đường');
  
  const rt = d.routes[0];
  let dist = rt.distance / 1000, dur = rt.duration / 60;
  if (profile === 'bicycle') dur = dur / 2.5;

  return { geometry: rt.geometry.coordinates, dist: dist, dur: dur };
}

/* ────────────────────────────────────────────────────────────────────────────
   §5  NOMINATIM GEOCODING (CẢI TIẾN TÌM XÃ/PHƯỜNG TỰ ĐỘNG FALLBACK)
──────────────────────────────────────────────────────────────────────────── */
const _geoCache=new Map();

async function geocode(query){
  const key=query.trim().toLowerCase();
  if(_geoCache.has(key)) return _geoCache.get(key);
  
  // 1. Tìm kiếm trong danh sách có sẵn (VN_PROVINCES, VN_SPOTS)
  for(const [name,coords] of Object.entries(VN_PROVINCES)){
    if(normStr(name).includes(normStr(query))||normStr(query).includes(normStr(name))){
      const r={lat:coords.lat,lon:coords.lon,name}; _geoCache.set(key,r); return r;
    }
  }
  for(const [name,coords] of Object.entries(VN_SPOTS)){
    if(normStr(name).includes(normStr(query))||normStr(query).includes(normStr(name))){
      const r={lat:coords.lat,lon:coords.lon,name}; _geoCache.set(key,r); return r;
    }
  }

  // 2. Bộ lọc làm sạch từ khóa trước khi gọi API Nominatim
  let cleanQuery = query.replace(/(rừng quốc gia|vườn quốc gia|khu du lịch sinh thái|khu du lịch|thành phố|tỉnh|huyện|thị xã|thị trấn|bãi biển)/gi, '').trim();
  cleanQuery = cleanQuery.replace(/\s*-\s*/g, ', '); // Đổi '-' thành ',' để API dễ nhận dạng cấu trúc địa lý

  const splitQuery = query.split(/[,-]/)[0].trim(); // Chỉ lấy vế đầu tiên

  // 3. Xếp hạng các kịch bản tìm kiếm từ chi tiết đến rút gọn
  const queriesToTry = [
    `${query}, Vietnam`,       // Ưu tiên 1: Thử nguyên bản
    `${cleanQuery}, Vietnam`,  // Ưu tiên 2: Đã lược bỏ tiền tố rườm rà (VD: "Cúc Phương, Ninh Bình")
    `${splitQuery}, Vietnam`   // Ưu tiên 3: Chỉ tìm tên cốt lõi (VD: "Cúc Phương")
  ];

  let data = [];
  for (const q of queriesToTry) {
    if (!q || q === ', Vietnam') continue;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&accept-language=vi`;
    
    try {
      const r = await fetch(url, {headers: {'User-Agent': 'SmartRoute-VN/1.0'}});
      data = await r.json();
      if (data && data.length > 0) break; // Ngừng vòng lặp ngay khi tìm thấy kết quả
    } catch(e) {
      console.warn('Lỗi gọi API ở từ khóa:', q);
    }
  }

  // 4. Nếu thử cả 3 cách vẫn thất bại, ném ra lỗi
  if(!data || !data.length) throw new Error(`Không tìm thấy: "${query}". Thử nhập tên ngắn gọn hơn hoặc kèm cấp Huyện/Tỉnh.`);
  
  // 5. Lưu Cache và trả kết quả
  const res={lat:+data[0].lat,lon:+data[0].lon,name:data[0].display_name.split(',')[0]};
  _geoCache.set(key,res); 
  return res;
}

function normStr(s){ return (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,c=>c==='đ'?'d':'D').toLowerCase().replace(/\s+/g,' ').trim(); }

const VN_PROVINCES={"An Giang":{lat:10.5216,lon:105.1259},"Bà Rịa - Vũng Tàu":{lat:10.5417,lon:107.2429},"Bắc Giang":{lat:21.2731,lon:106.1946},"Bắc Kạn":{lat:22.1436,lon:105.8348},"Bạc Liêu":{lat:9.2840,lon:105.7243},"Bắc Ninh":{lat:21.1214,lon:106.1111},"Bến Tre":{lat:10.2433,lon:106.3756},"Bình Định":{lat:13.7765,lon:109.2237},"Bình Dương":{lat:11.1667,lon:106.6667},"Bình Phước":{lat:11.7511,lon:106.9235},"Bình Thuận":{lat:11.0904,lon:108.0721},"Cà Mau":{lat:9.1527,lon:105.1960},"Cần Thơ":{lat:10.0452,lon:105.7469},"Cao Bằng":{lat:22.6657,lon:106.2522},"Đà Nẵng":{lat:16.0544,lon:108.2022},"Đắk Lắk":{lat:12.7100,lon:108.2378},"Đắk Nông":{lat:12.0048,lon:107.6877},"Điện Biên":{lat:21.3860,lon:103.0230},"Đồng Nai":{lat:11.0686,lon:107.1676},"Đồng Tháp":{lat:10.4939,lon:105.6882},"Gia Lai":{lat:13.9717,lon:108.4420},"Hà Giang":{lat:22.8026,lon:104.9784},"Hà Nam":{lat:20.5835,lon:105.9229},"Hà Nội":{lat:21.0285,lon:105.8542},"Hà Tĩnh":{lat:18.3559,lon:105.8877},"Hải Dương":{lat:20.9373,lon:106.3147},"Hải Phòng":{lat:20.8449,lon:106.6881},"Hậu Giang":{lat:9.7579,lon:105.6413},"Hòa Bình":{lat:20.8133,lon:105.3383},"Hưng Yên":{lat:20.6462,lon:106.0513},"Khánh Hòa":{lat:12.2388,lon:109.1967},"Kiên Giang":{lat:10.0125,lon:105.0809},"Kon Tum":{lat:14.3497,lon:108.0005},"Lai Châu":{lat:22.3964,lon:103.4592},"Lâm Đồng":{lat:11.9465,lon:108.4419},"Lạng Sơn":{lat:21.8537,lon:106.7615},"Lào Cai":{lat:22.4809,lon:103.9754},"Long An":{lat:10.5353,lon:106.4071},"Nam Định":{lat:20.4338,lon:106.1621},"Nghệ An":{lat:19.2342,lon:104.9200},"Ninh Bình":{lat:20.2506,lon:105.9745},"Ninh Thuận":{lat:11.5654,lon:108.9886},"Phú Thọ":{lat:21.4177,lon:105.2272},"Phú Yên":{lat:13.0882,lon:109.0928},"Quảng Bình":{lat:17.4889,lon:106.5986},"Quảng Nam":{lat:15.5394,lon:108.0191},"Quảng Ngãi":{lat:15.1214,lon:108.8092},"Quảng Ninh":{lat:21.0064,lon:107.2925},"Quảng Trị":{lat:16.7527,lon:107.1874},"Sóc Trăng":{lat:9.6003,lon:105.9800},"Sơn La":{lat:21.3256,lon:103.9188},"Tây Ninh":{lat:11.3351,lon:106.1098},"Thái Bình":{lat:20.4470,lon:106.3422},"Thái Nguyên":{lat:21.5942,lon:105.8412},"Thanh Hóa":{lat:19.8067,lon:105.7851},"Thừa Thiên Huế":{lat:16.4674,lon:107.5905},"Tiền Giang":{lat:10.4493,lon:106.3421},"TP. Hồ Chí Minh":{lat:10.8231,lon:106.6297},"Trà Vinh":{lat:9.9477,lon:106.3420},"Tuyên Quang":{lat:21.7767,lon:105.2280},"Vĩnh Long":{lat:10.2538,lon:105.9722},"Vĩnh Phúc":{lat:21.3089,lon:105.6047},"Yên Bái":{lat:21.7051,lon:104.9054}};
const VN_SPOTS={"Hội An":{lat:15.8800,lon:108.3380},"Phú Quốc":{lat:10.2899,lon:103.9840},"Sa Pa":{lat:22.3364,lon:103.8440},"Vũng Tàu":{lat:10.3460,lon:107.0843},"Nha Trang":{lat:12.2388,lon:109.1967},"Đà Lạt":{lat:11.9404,lon:108.4583},"Mũi Né":{lat:10.9333,lon:108.2833},"Huế":{lat:16.4674,lon:107.5905},"Vịnh Hạ Long":{lat:20.9517,lon:107.0852},"Tam Cốc":{lat:20.2278,lon:105.9462}};

/* ────────────────────────────────────────────────────────────────────────────
   §6  DATA - TOURIST ATTRACTIONS (Đã được mở rộng toàn diện)
──────────────────────────────────────────────────────────────────────────── */
const TOURIST_ATTRACTIONS = [
  // Miền Bắc
  { name: "Mã Pí Lèng", lat: 23.2385, lon: 105.4190, prov: "Hà Giang", icon: "🏍️" },
  { name: "Cột cờ Lũng Cú", lat: 23.3638, lon: 105.3168, prov: "Hà Giang", icon: "🇻🇳" },
  { name: "Cao nguyên đá Đồng Văn", lat: 23.2798, lon: 105.3621, prov: "Hà Giang", icon: "🪨" },
  { name: "Dinh Thự Vua Mèo", lat: 23.2592, lon: 105.2530, prov: "Hà Giang", icon: "🏯" },
  { name: "Thác Bản Giốc", lat: 22.8553, lon: 106.7243, prov: "Cao Bằng", icon: "🌊" },
  { name: "Suối Lê Nin - Hang Pác Bó", lat: 22.9760, lon: 106.0505, prov: "Cao Bằng", icon: "🏞️" },
  { name: "Động Ngườm Ngao", lat: 22.8465, lon: 106.7118, prov: "Cao Bằng", icon: "🦇" },
  { name: "Hồ Ba Bể", lat: 22.4087, lon: 105.6174, prov: "Bắc Kạn", icon: "🛶" },
  { name: "Đỉnh Fansipan", lat: 22.3055, lon: 103.7758, prov: "Lào Cai", icon: "⛰️" },
  { name: "Bản Cát Cát", lat: 22.3243, lon: 103.8329, prov: "Lào Cai", icon: "🏘️" },
  { name: "Đỉnh Lảo Thẩn", lat: 22.6074, lon: 103.6268, prov: "Lào Cai", icon: "☁️" },
  { name: "Y Tý", lat: 22.6565, lon: 103.6210, prov: "Lào Cai", icon: "☁️" },
  { name: "Đèo Ô Quy Hồ", lat: 22.3551, lon: 103.7844, prov: "Lai Châu", icon: "☁️" },
  { name: "Di tích Mường Thanh", lat: 21.3887, lon: 103.0135, prov: "Điện Biên", icon: "🪖" },
  { name: "Đồi chè Trái Tim", lat: 20.8443, lon: 104.6499, prov: "Mộc Châu, Sơn La", icon: "🍃" },
  { name: "Thác Dải Yếm", lat: 20.8166, lon: 104.6068, prov: "Sơn La", icon: "🌊" },
  { name: "Rừng thông Bản Áng", lat: 20.8180, lon: 104.6468, prov: "Sơn La", icon: "🌲" },
  { name: "Mù Cang Chải", lat: 21.7891, lon: 104.2253, prov: "Yên Bái", icon: "🌾" },
  { name: "Đền Hùng", lat: 21.3653, lon: 105.3161, prov: "Phú Thọ", icon: "⛩️" },
  { name: "Tam Đảo", lat: 21.4578, lon: 105.6480, prov: "Vĩnh Phúc", icon: "🏰" },
  { name: "Hồ Gươm", lat: 21.0287, lon: 105.8524, prov: "Hà Nội", icon: "🐢" },
  { name: "Lăng Bác", lat: 21.0366, lon: 105.8346, prov: "Hà Nội", icon: "🏛️" },
  { name: "Văn Miếu Quốc Tử Giám", lat: 21.0293, lon: 105.8354, prov: "Hà Nội", icon: "⛩️" },
  { name: "Chùa Một Cột", lat: 21.0360, lon: 105.8335, prov: "Hà Nội", icon: "🛕" },
  { name: "Hoàng Thành Thăng Long", lat: 21.0345, lon: 105.8394, prov: "Hà Nội", icon: "🏰" },
  { name: "Cầu Long Biên", lat: 21.0428, lon: 105.8596, prov: "Hà Nội", icon: "🌉" },
  { name: "Nhà hát Lớn Hà Nội", lat: 21.0240, lon: 105.8573, prov: "Hà Nội", icon: "🏛️" },
  { name: "Hồ Tây", lat: 21.0560, lon: 105.8208, prov: "Hà Nội", icon: "🌅" },
  { name: "Làng gốm Bát Tràng", lat: 20.9782, lon: 105.9189, prov: "Hà Nội", icon: "🏺" },
  { name: "Vịnh Hạ Long", lat: 20.9101, lon: 107.1839, prov: "Quảng Ninh", icon: "🛳️" },
  { name: "Đỉnh Yên Tử", lat: 21.1610, lon: 106.7183, prov: "Quảng Ninh", icon: "☁️" },
  { name: "Sun World Hạ Long", lat: 20.9566, lon: 107.0343, prov: "Quảng Ninh", icon: "🎡" },
  { name: "Bảo tàng Quảng Ninh", lat: 20.9554, lon: 107.0984, prov: "Quảng Ninh", icon: "🏛️" },
  { name: "Đảo Tuần Châu", lat: 20.9315, lon: 106.9934, prov: "Quảng Ninh", icon: "🏝️" },
  { name: "Bình Liêu", lat: 21.5649, lon: 107.4116, prov: "Quảng Ninh", icon: "🌾" },
  { name: "Đảo Cát Bà", lat: 20.7303, lon: 107.0396, prov: "Hải Phòng", icon: "🏝️" },
  { name: "Quần thể Tràng An", lat: 20.2541, lon: 105.9221, prov: "Ninh Bình", icon: "🛶" },
  { name: "Chùa Bái Đính", lat: 20.2789, lon: 105.8828, prov: "Ninh Bình", icon: "🛕" },
  { name: "Tam Cốc", lat: 20.2198, lon: 105.9388, prov: "Ninh Bình", icon: "🌾" },
  { name: "Hang Múa", lat: 20.2435, lon: 105.9458, prov: "Ninh Bình", icon: "⛰️" },
  { name: "Thung Nham", lat: 20.2075, lon: 105.8856, prov: "Ninh Bình", icon: "🕊️" },
  { name: "Đầm Vân Long", lat: 20.3804, lon: 105.8596, prov: "Ninh Bình", icon: "🛶" },
  { name: "Rừng quốc gia Cúc Phương", lat: 20.3168, lon: 105.6033, prov: "Ninh Bình", icon: "🦋" },
  { name: "Thung lũng Mai Châu", lat: 20.6601, lon: 105.0805, prov: "Hòa Bình", icon: "🏘️" },
  { name: "Hồ thủy điện Hòa Bình", lat: 20.8038, lon: 105.3195, prov: "Hòa Bình", icon: "⚡" },

  // Miền Trung
  { name: "Biển Sầm Sơn", lat: 19.7423, lon: 105.9038, prov: "Thanh Hóa", icon: "🏖️" },
  { name: "Pù Luông", lat: 20.4497, lon: 105.2312, prov: "Thanh Hóa", icon: "🏡" },
  { name: "Biển Cửa Lò", lat: 18.8105, lon: 105.7176, prov: "Nghệ An", icon: "🐚" },
  { name: "Ngã ba Đồng Lộc", lat: 18.3976, lon: 105.7725, prov: "Hà Tĩnh", icon: "⭐" },
  { name: "Phong Nha - Kẻ Bàng", lat: 17.5878, lon: 106.2842, prov: "Quảng Bình", icon: "🦇" },
  { name: "Hang Sơn Đoòng", lat: 17.4526, lon: 106.2878, prov: "Quảng Bình", icon: "⛰️" },
  { name: "Hang Thiên Đường", lat: 17.5255, lon: 106.2233, prov: "Quảng Bình", icon: "🦇" },
  { name: "Suối nước Moọc", lat: 17.5645, lon: 106.2415, prov: "Quảng Bình", icon: "🏞️" },
  { name: "Vũng Chùa Đảo Yến", lat: 17.9351, lon: 106.4526, prov: "Quảng Bình", icon: "🕊️" },
  { name: "Thành cổ Quảng Trị", lat: 16.7483, lon: 107.1950, prov: "Quảng Trị", icon: "🏯" },
  { name: "Đại Nội Huế", lat: 16.4682, lon: 107.5779, prov: "Thừa Thiên Huế", icon: "👑" },
  { name: "Lăng Tự Đức", lat: 16.4326, lon: 107.5670, prov: "Thừa Thiên Huế", icon: "⛩️" },
  { name: "Chợ Đông Ba", lat: 16.4716, lon: 107.5901, prov: "Thừa Thiên Huế", icon: "🛍️" },
  { name: "Chùa Thiên Mụ", lat: 16.4533, lon: 107.5451, prov: "Thừa Thiên Huế", icon: "🛕" },
  { name: "Lăng Minh Mạng", lat: 16.3887, lon: 107.5732, prov: "Thừa Thiên Huế", icon: "⛩️" },
  { name: "Lăng Khải Định", lat: 16.3986, lon: 107.5904, prov: "Thừa Thiên Huế", icon: "⛩️" },
  { name: "Đồi Vọng Cảnh", lat: 16.4357, lon: 107.5583, prov: "Thừa Thiên Huế", icon: "🌅" },
  { name: "Biển Thuận An", lat: 16.5645, lon: 107.6321, prov: "Thừa Thiên Huế", icon: "🏖️" },
  { name: "Bà Nà Hills", lat: 15.9977, lon: 107.9880, prov: "Đà Nẵng", icon: "🎡" },
  { name: "Bán đảo Sơn Trà", lat: 16.1260, lon: 108.2831, prov: "Đà Nẵng", icon: "🐒" },
  { name: "Đèo Hải Vân", lat: 16.1923, lon: 108.1309, prov: "Đà Nẵng", icon: "⛰️" },
  { name: "Cầu Rồng", lat: 16.0610, lon: 108.2268, prov: "Đà Nẵng", icon: "🐉" },
  { name: "Ngũ Hành Sơn", lat: 16.0028, lon: 108.2635, prov: "Đà Nẵng", icon: "⛰️" },
  { name: "Chùa Linh Ứng", lat: 16.1001, lon: 108.2778, prov: "Đà Nẵng", icon: "🛕" },
  { name: "Công viên Châu Á", lat: 16.0396, lon: 108.2274, prov: "Đà Nẵng", icon: "🎡" },
  { name: "Bãi biển Mỹ Khê", lat: 16.0592, lon: 108.2464, prov: "Đà Nẵng", icon: "🏖️" },
  { name: "Phố cổ Hội An", lat: 15.8795, lon: 108.3283, prov: "Quảng Nam", icon: "🏮" },
  { name: "Thánh địa Mỹ Sơn", lat: 15.7656, lon: 108.1105, prov: "Quảng Nam", icon: "🗿" },
  { name: "Rừng dừa Bảy Mẫu", lat: 15.8679, lon: 108.3622, prov: "Quảng Nam", icon: "🥥" },
  { name: "Cù Lao Chàm", lat: 15.9555, lon: 108.5135, prov: "Quảng Nam", icon: "🏝️" },
  { name: "Làng bích họa Tam Thanh", lat: 15.5862, lon: 108.5173, prov: "Quảng Nam", icon: "🎨" },
  { name: "Đảo Lý Sơn", lat: 15.3780, lon: 109.1171, prov: "Quảng Ngãi", icon: "🧄" },
  { name: "Kỳ Co - Eo Gió", lat: 13.9317, lon: 109.3005, prov: "Bình Định", icon: "🌊" },
  { name: "Hầm Hô", lat: 13.9312, lon: 108.9667, prov: "Bình Định", icon: "🛶" },
  { name: "Cù Lao Xanh", lat: 13.6215, lon: 109.2435, prov: "Bình Định", icon: "🏝️" },
  { name: "Ghềnh Đá Đĩa", lat: 13.3422, lon: 109.2991, prov: "Phú Yên", icon: "🪨" },
  { name: "Hải đăng Đại Lãnh", lat: 12.8761, lon: 109.3956, prov: "Phú Yên", icon: "🗼" },
  { name: "Bãi Xép", lat: 13.1092, lon: 109.2941, prov: "Phú Yên", icon: "🏜️" },
  { name: "Vinwonders Nha Trang", lat: 12.2198, lon: 109.2407, prov: "Khánh Hòa", icon: "🎢" },
  { name: "Đảo Hòn Mun", lat: 12.1666, lon: 109.3005, prov: "Khánh Hòa", icon: "🐠" },
  { name: "Tháp Bà Ponagar", lat: 12.2654, lon: 109.1959, prov: "Khánh Hòa", icon: "🛕" },
  { name: "Hòn Chồng", lat: 12.2713, lon: 109.2023, prov: "Khánh Hòa", icon: "🪨" },
  { name: "Viện Hải dương học", lat: 12.2085, lon: 109.2144, prov: "Khánh Hòa", icon: "🐡" },
  { name: "Đảo Điệp Sơn", lat: 12.6718, lon: 109.3087, prov: "Khánh Hòa", icon: "🏝️" },
  { name: "Vịnh Vĩnh Hy", lat: 11.7330, lon: 109.1963, prov: "Ninh Thuận", icon: "🛥️" },
  { name: "Tháp Chàm Po Klong Garai", lat: 11.6030, lon: 108.9482, prov: "Ninh Thuận", icon: "🛕" },
  { name: "Đồng cừu An Hòa", lat: 11.6420, lon: 108.8950, prov: "Ninh Thuận", icon: "🐑" },
  { name: "Đồi cát Mũi Né", lat: 10.9479, lon: 108.2861, prov: "Bình Thuận", icon: "🏜️" },
  { name: "Biển Cổ Thạch", lat: 11.2676, lon: 108.7460, prov: "Bình Thuận", icon: "🪨" },
  { name: "Hải đăng Kê Gà", lat: 10.6978, lon: 107.9794, prov: "Bình Thuận", icon: "🗼" },

  // Tây Nguyên
  { name: "Khu du lịch Măng Đen", lat: 14.6068, lon: 108.2934, prov: "Kon Tum", icon: "🌲" },
  { name: "Ngã ba Đông Dương", lat: 14.6931, lon: 107.5562, prov: "Kon Tum", icon: "📍" },
  { name: "Nhà rông Kon Klor", lat: 14.3415, lon: 108.0195, prov: "Kon Tum", icon: "🛖" },
  { name: "Biển Hồ", lat: 14.0536, lon: 108.0063, prov: "Gia Lai", icon: "🏞️" },
  { name: "Chùa Minh Thành", lat: 13.9715, lon: 108.0163, prov: "Gia Lai", icon: "🛕" },
  { name: "Núi lửa Chư Đăng Ya", lat: 14.1206, lon: 108.0494, prov: "Gia Lai", icon: "🌋" },
  { name: "Hồ Lắk", lat: 12.4332, lon: 108.1837, prov: "Đắk Lắk", icon: "🐘" },
  { name: "Bảo tàng Thế giới Cà phê", lat: 12.6841, lon: 108.0315, prov: "Đắk Lắk", icon: "☕" },
  { name: "Thác Dray Nur", lat: 12.5381, lon: 107.8920, prov: "Đắk Lắk", icon: "🌊" },
  { name: "Hồ Tà Đùng", lat: 11.8368, lon: 108.0263, prov: "Đắk Nông", icon: "🛶" },
  { name: "Thung lũng Tình Yêu", lat: 11.9772, lon: 108.4554, prov: "Lâm Đồng", icon: "❤️" },
  { name: "Đỉnh Langbiang", lat: 12.0468, lon: 108.4287, prov: "Lâm Đồng", icon: "⛰️" },
  { name: "Hồ Tuyền Lâm", lat: 11.8950, lon: 108.4357, prov: "Lâm Đồng", icon: "🛶" },
  { name: "Thác Datanla", lat: 11.9015, lon: 108.4497, prov: "Lâm Đồng", icon: "🌊" },
  { name: "Chợ Đà Lạt", lat: 11.9427, lon: 108.4368, prov: "Lâm Đồng", icon: "🛍️" },
  { name: "Đường hầm điêu khắc", lat: 11.8845, lon: 108.4116, prov: "Lâm Đồng", icon: "🗿" },
  { name: "Thiền viện Trúc Lâm", lat: 11.9038, lon: 108.4353, prov: "Lâm Đồng", icon: "🛕" },
  { name: "Hồ Xuân Hương", lat: 11.9428, lon: 108.4485, prov: "Lâm Đồng", icon: "🦢" },
  { name: "Thác Pongour", lat: 11.6961, lon: 108.2642, prov: "Lâm Đồng", icon: "🌊" },
  { name: "Chùa Linh Phước", lat: 11.9431, lon: 108.4984, prov: "Lâm Đồng", icon: "🛕" },

  // Miền Nam
  { name: "Chợ Bến Thành", lat: 10.7725, lon: 106.6981, prov: "TP. Hồ Chí Minh", icon: "🏢" },
  { name: "Landmark 81", lat: 10.7946, lon: 106.7216, prov: "TP. Hồ Chí Minh", icon: "🏙️" },
  { name: "Dinh Độc Lập", lat: 10.7769, lon: 106.6953, prov: "TP. Hồ Chí Minh", icon: "🏛️" },
  { name: "Nhà thờ Đức Bà", lat: 10.7797, lon: 106.6990, prov: "TP. Hồ Chí Minh", icon: "⛪" },
  { name: "Bưu điện Trung tâm", lat: 10.7799, lon: 106.7001, prov: "TP. Hồ Chí Minh", icon: "🏤" },
  { name: "Phố đi bộ Nguyễn Huệ", lat: 10.7738, lon: 106.7031, prov: "TP. Hồ Chí Minh", icon: "🚶" },
  { name: "Suối Tiên", lat: 10.8643, lon: 106.8028, prov: "TP. Hồ Chí Minh", icon: "🐉" },
  { name: "Đầm Sen", lat: 10.7663, lon: 106.6391, prov: "TP. Hồ Chí Minh", icon: "🎢" },
  { name: "Khu du lịch sinh thái Cần Giờ", lat: 10.4131, lon: 106.8833, prov: "TP. Hồ Chí Minh", icon: "🐒" },
  { name: "Bảo tàng Chứng tích Chiến tranh", lat: 10.7781, lon: 106.6905, prov: "TP. Hồ Chí Minh", icon: "🪖" },
  { name: "Địa đạo Củ Chi", lat: 11.1423, lon: 106.4632, prov: "TP. Hồ Chí Minh", icon: "🕳️" },
  { name: "Vườn Quốc Gia Cát Tiên", lat: 11.4116, lon: 107.3916, prov: "Đồng Nai", icon: "🐆" },
  { name: "Khu du lịch Bửu Long", lat: 10.9754, lon: 106.8041, prov: "Đồng Nai", icon: "🏞️" },
  { name: "Núi Bà Đen", lat: 11.3725, lon: 106.1664, prov: "Tây Ninh", icon: "🚠" },
  { name: "Tòa thánh Tây Ninh", lat: 11.3142, lon: 106.1264, prov: "Tây Ninh", icon: "⛩️" },
  { name: "Tượng Chúa Kito", lat: 10.3276, lon: 107.0841, prov: "Bà Rịa - Vũng Tàu", icon: "🗿" },
  { name: "Nhà tù Côn Đảo", lat: 8.6811, lon: 106.6083, prov: "Bà Rịa - Vũng Tàu", icon: "⚓" },
  { name: "Bạch Dinh", lat: 10.3400, lon: 107.0701, prov: "Bà Rịa - Vũng Tàu", icon: "🏛️" },
  { name: "Hồ Mây Park", lat: 10.3540, lon: 107.0601, prov: "Bà Rịa - Vũng Tàu", icon: "🚠" },
  { name: "Bãi Sau", lat: 10.3407, lon: 107.0872, prov: "Bà Rịa - Vũng Tàu", icon: "🏖️" },
  { name: "Bãi Trước", lat: 10.3458, lon: 107.0704, prov: "Bà Rịa - Vũng Tàu", icon: "🏖️" },
  { name: "Cảng Bến Đầm", lat: 8.6256, lon: 106.5517, prov: "Bà Rịa - Vũng Tàu", icon: "🚢" },
  { name: "Làng nổi Tân Lập", lat: 10.7062, lon: 105.9400, prov: "Long An", icon: "🌳" },
  { name: "Cồn Thới Sơn", lat: 10.3341, lon: 106.3353, prov: "Bến Tre", icon: "🌴" },
  { name: "Cồn Phụng", lat: 10.2974, lon: 106.3315, prov: "Bến Tre", icon: "🥥" },
  { name: "Tràm Chim", lat: 10.7062, lon: 105.5134, prov: "Đồng Tháp", icon: "🦩" },
  { name: "Khu du lịch Xẻo Quýt", lat: 10.3662, lon: 105.8166, prov: "Đồng Tháp", icon: "🛶" },
  { name: "Chợ nổi Cái Răng", lat: 10.0033, lon: 105.7483, prov: "Cần Thơ", icon: "🚤" },
  { name: "Nhà cổ Bình Thủy", lat: 10.0544, lon: 105.7486, prov: "Cần Thơ", icon: "🏡" },
  { name: "Bến Ninh Kiều", lat: 10.0315, lon: 105.7876, prov: "Cần Thơ", icon: "🛥️" },
  { name: "Thiền viện Trúc Lâm Phương Nam", lat: 10.0075, lon: 105.6980, prov: "Cần Thơ", icon: "🛕" },
  { name: "Miếu Bà Chúa Xứ", lat: 10.6698, lon: 105.0768, prov: "An Giang", icon: "🏯" },
  { name: "Rừng tràm Trà Sư", lat: 10.5779, lon: 105.0478, prov: "An Giang", icon: "🛶" },
  { name: "Chùa Dơi", lat: 9.5886, lon: 105.9723, prov: "Sóc Trăng", icon: "🦇" },
  { name: "Chùa Chén Kiểu", lat: 9.5512, lon: 105.9863, prov: "Sóc Trăng", icon: "🛕" },
  { name: "Nhà máy điện gió Bạc Liêu", lat: 9.2312, lon: 105.8155, prov: "Bạc Liêu", icon: "🎐" },
  { name: "Nhà công tử Bạc Liêu", lat: 9.2941, lon: 105.7277, prov: "Bạc Liêu", icon: "🏛️" },
  { name: "Đảo Ngọc Phú Quốc", lat: 10.2289, lon: 103.9572, prov: "Kiên Giang", icon: "🏖️" },
  { name: "VinWonders Phú Quốc", lat: 10.3340, lon: 103.8540, prov: "Kiên Giang", icon: "🏰" },
  { name: "Grand World Phú Quốc", lat: 10.3255, lon: 103.8505, prov: "Kiên Giang", icon: "🎡" },
  { name: "Bãi Sao", lat: 10.0357, lon: 104.0353, prov: "Kiên Giang", icon: "🏖️" },
  { name: "Dinh Cậu", lat: 10.2173, lon: 103.9557, prov: "Kiên Giang", icon: "⛩️" },
  { name: "Hòn Thơm", lat: 9.9575, lon: 104.0152, prov: "Kiên Giang", icon: "🚠" },
  { name: "Quần đảo Nam Du", lat: 9.6800, lon: 104.3547, prov: "Kiên Giang", icon: "🏝️" },
  { name: "Mũi Cà Mau", lat: 8.6231, lon: 104.7214, prov: "Cà Mau", icon: "🦀" },
  { name: "Rừng quốc gia U Minh Hạ", lat: 9.2612, lon: 104.9392, prov: "Cà Mau", icon: "🌳" },
  { name: "Đất Mũi", lat: 8.6015, lon: 104.7236, prov: "Cà Mau", icon: "📍" }
];

/* ────────────────────────────────────────────────────────────────────────────
   §7  MAP INITIALISATION (MULTI-LAYERS MAP & REVERSE GEOCODING)
──────────────────────────────────────────────────────────────────────────── */
let map, geoLayer, touristLayer, selProv=null;

function initMap(){
  map = L.map('map', {center: [16.2, 107.8], zoom: 6, zoomControl: true});
  const ggStreets = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=vi', {attribution: '© Google Maps', maxZoom: 20});
  const ggHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=vi', {attribution: '© Google Maps', maxZoom: 20});
  const ggTerrain = L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}&hl=vi', {attribution: '© Google Maps', maxZoom: 20});
  const darkMap = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {attribution: '© CARTO', maxZoom: 19});

  ggStreets.addTo(map);
  const baseMaps = {"🗺️ Google Maps (Chi tiết)": ggStreets, "⛰️ Google Địa hình": ggTerrain, "🛰️ Google Vệ tinh": ggHybrid, "🌙 Ban đêm": darkMap};
  L.control.layers(baseMaps, null, { position: 'topleft', collapsed : true }).addTo(map);

  loadProvinceGeoJSON();
  setupTouristLayer(); // ★ KHỞI TẠO LAYER DU LỊCH & SỰ KIỆN ZOOM

  map.on('click', async function(e) {
    if (currentTab === 'planner') switchTab('map');
    const lat = e.latlng.lat, lon = e.latlng.lng;
    showLoader('Đang phân tích địa điểm...');
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=vi`);
        const data = await res.json();
        const addr = data.address || {};
        const localName = addr.village || addr.suburb || addr.town || addr.city_district || addr.city || addr.county || "Địa điểm chưa rõ";
        const fullAddress = (data.display_name || '').split(',').slice(0, 3).join(',').trim();
        await showSidebarWeather(localName, {lat: lat, lon: lon}, fullAddress);
        if (window.tempMarker) map.removeLayer(window.tempMarker);
        window.tempMarker = L.marker([lat, lon]).addTo(map).bindPopup(`<div style="font-family:'Rajdhani',sans-serif"><b>${localName}</b><br><span style="font-size:11px;color:var(--dim)">${fullAddress}</span></div>`).openPopup();
    } catch (error) { console.error(error); showToast('⚠️ Không thể phân tích địa điểm này', 'warn'); } finally { hideLoader(); }
  });
}

function setupTouristLayer() {
  touristLayer = L.layerGroup();
  TOURIST_ATTRACTIONS.forEach(spot => {
    const customIcon = L.divIcon({ html: `<div class="tourist-marker">${spot.icon}</div>`, className: '', iconSize: [24, 24], iconAnchor: [12, 12] });
    const marker = L.marker([spot.lat, spot.lon], {icon: customIcon});
    marker.bindTooltip(`<b>${spot.name}</b><br><span style="font-size:10px;color:var(--dim)">${spot.prov}</span>`, {direction: 'top', offset: [0, -10], className: 'leaflet-tooltip'});
    marker.on('click', (e) => {
       L.DomEvent.stopPropagation(e); 
       if (currentTab === 'planner') switchTab('map');
       showSidebarWeather(spot.name, {lat: spot.lat, lon: spot.lon}, `${spot.name} - ${spot.prov}`);
    });
    touristLayer.addLayer(marker);
  });
  
  // ★ LOGIC ẨN HIỆN THEO ZOOM (NGƯỠNG: 9)
  const ZOOM_THRESHOLD = 9;
  if (map.getZoom() >= ZOOM_THRESHOLD) touristLayer.addTo(map);

  map.on('zoomend', function() {
      if (map.getZoom() >= ZOOM_THRESHOLD) {
          if (!map.hasLayer(touristLayer)) map.addLayer(touristLayer);
      } else {
          if (map.hasLayer(touristLayer)) map.removeLayer(touristLayer);
      }
  });
}

async function loadProvinceGeoJSON(){
  try{ const r=await fetch('https://raw.githubusercontent.com/TungTh/tungth.github.io/master/data/vn-provinces.json'); if(r.ok) buildGeoLayer(await r.json()); }catch(e){}
}

function buildGeoLayer(data){
  geoLayer=L.geoJSON(data,{ interactive: false, style:()=>({fillColor:'var(--jade)',fillOpacity:0.02,color:'var(--brd2)',weight:1.2,opacity:.9}) }).addTo(map);
}

/* ────────────────────────────────────────────────────────────────────────────
   §8  MODULE A — API CHAINING
──────────────────────────────────────────────────────────────────────────── */
let state={ route:null, waypoints:[], weather:[], hIdxArr:[], altRoute:null, altWps:[], altWeather:[], altHIdxArr:[], selectedHour:8, departDate:todayStr(), viewAlt:false, selectedDay:0, currentViewDate:null, totalTripDays:0 };
let routeLayer=null, altRouteLayer=null, markersList=[];

function initDualSliders(legs){
  let totalDays=0;
  if(legs && legs.length>0){
    const lastLeg=legs[legs.length-1];
    const [dY,dM,dD]=state.departDate.split('-').map(Number);
    const diffMs=lastLeg.arrDateTime.getTime()-new Date(dY,dM-1,dD,0,0,0).getTime();
    totalDays=Math.ceil(diffMs/86400000);
  }
  totalDays=Math.max(0,Math.min(totalDays, 30));
  state.totalTripDays=totalDays; state.selectedDay=0; state.currentViewDate=state.departDate;

  const daySl=document.getElementById('day-slider'); daySl.min=0; daySl.max=totalDays; daySl.value=0; _setDayGradient(daySl,0,totalDays);
  const hrSl=document.getElementById('hour-slider'); hrSl.min=0; hrSl.max=23; hrSl.value=state.selectedHour; _setHourGradient(hrSl,state.selectedHour);

  _updateDayLabel(0); document.getElementById('tb-val').textContent=`${String(state.selectedHour).padStart(2,'0')}:00`;
  _renderDayTicks(totalDays); _renderHourTicks();
  daySl.oninput=_onDaySliderInput; hrSl.oninput =_onHourSliderInput;
  document.getElementById('time-bar').classList.add('visible');
}

function _renderDayTicks(totalDays){
  const el=document.getElementById('tb-day-tick'); if(!el) return;
  const ticks=[];
  for(let d=0;d<=totalDays;d++){
    if (totalDays > 15 && d % 3 !== 0 && d !== totalDays && d !== 0) ticks.push(`<span></span>`);
    else if (totalDays > 8 && d % 2 !== 0 && d !== totalDays && d !== 0) ticks.push(`<span></span>`);
    else ticks.push(`<span>${fmtDate(addDays(state.departDate,d),{day:'2-digit',month:'2-digit'})}</span>`);
  }
  el.innerHTML=ticks.join('');
}

function updateSliderWx(wData,hArr){
  let worst=null,worstSev=-1, hasNoData=false;
  wData.forEach((wd,i)=>{
    const hi=hArr[i]; if(hi === -1 || hi === undefined) { hasNoData = true; return; } 
    if(!wd?.hourly) return;
    const info=wmo(wd.hourly.weathercode?.[hi]||0);
    if(info.s>worstSev){ worstSev=info.s; worst=info; }
  });

  const wxEl=document.getElementById('tb-wx');
  if(wxEl){
    if(worst) wxEl.innerHTML=`<div class="wx-icon">${worst.e}</div><div class="wx-cond" style="color:${SEV_COLORS[worst.s]}">${worst.v}</div>`;
    else if (hasNoData) wxEl.innerHTML=`<div class="wx-icon" style="filter:grayscale(1)">❓</div><div class="wx-cond" style="color:var(--dim)">Chưa có dự báo</div>`;
  }
  const mw=state.route?calcRouteWeight(state.route.dist,state.weather,hArr):null;
  const aw=state.altRoute?calcRouteWeight(state.altRoute.dist,state.altWeather,state.altHIdxArr):null;
  const stEl=document.getElementById('tb-status');
  if(stEl) stEl.innerHTML=[`WP: <span style="color:var(--jade)">${state.waypoints.length}</span>`,mw!=null?`W: <span style="color:${mw>250?'var(--danger)':'var(--ok)'}">${mw.toFixed(0)}</span>`:'',aw!=null?`W-Alt: <span style="color:${aw<mw?'var(--ok)':'var(--gold)'}">${aw.toFixed(0)}</span>`:''].filter(Boolean).join(' · ');
}

function _setDayGradient(el,val,max){ el.style.background=`linear-gradient(to right,var(--violet) ${max>0?(val/max)*100:0}%,var(--brd2) ${max>0?(val/max)*100:0}%)`; }
function _setHourGradient(el,hr){ el.style.background=`linear-gradient(to right,var(--jade) ${(hr/23)*100}%,var(--brd2) ${(hr/23)*100}%)`; }
function _updateDayLabel(dayOff){ const d=addDays(state.departDate,dayOff); const valEl=document.getElementById('tb-day-val'), subEl=document.getElementById('tb-day-sub'); if(valEl) valEl.textContent=fmtDate(d,{day:'2-digit',month:'2-digit'}); if(subEl) subEl.textContent=dayVN(d); }
function _renderHourTicks(){ const el=document.getElementById('tb-tick'); if(el) el.innerHTML=[0,3,6,9,12,15,18,21,23].map(h=>`<span>${String(h).padStart(2,'0')}</span>`).join(''); }

function _onDaySliderInput(){
  const dayOff=+this.value; state.selectedDay=dayOff; _setDayGradient(this,dayOff,state.totalTripDays); _updateDayLabel(dayOff);
  if(!state.waypoints.length) return;
  const targetDate=addDays(state.departDate,dayOff); state.currentViewDate=targetDate; const hr=state.selectedHour;
  const hArr=state.weather.map(w=>hourIdx(w?.hourly?.time,targetDate,hr)); state.hIdxArr=hArr;
  if(state.viewAlt&&state.altWps.length){ const aArr=state.altWeather.map(w=>hourIdx(w?.hourly?.time,targetDate,hr)); state.altHIdxArr=aArr; drawWaypointMarkers(state.altWps,state.altWeather,aArr,true); } 
  else { drawWaypointMarkers(state.waypoints,state.weather,hArr,false); }
  updateSliderWx(state.weather,hArr);
}

function _onHourSliderInput(){
  const hr=+this.value; state.selectedHour=hr; _setHourGradient(this,hr); document.getElementById('tb-val').textContent=`${String(hr).padStart(2,'0')}:00`;
  if(!state.waypoints.length) return;
  const targetDate=state.currentViewDate||state.departDate;
  const hArr=state.weather.map(w=>hourIdx(w?.hourly?.time,targetDate,hr)); state.hIdxArr=hArr;
  if(state.viewAlt&&state.altWps.length){ const aArr=state.altWeather.map(w=>hourIdx(w?.hourly?.time,targetDate,hr)); state.altHIdxArr=aArr; drawWaypointMarkers(state.altWps,state.altWeather,aArr,true); } 
  else { drawWaypointMarkers(state.waypoints,state.weather,hArr,false); }
  updateSliderWx(state.weather,hArr);
}

function detectAnomalies(wData,wps,hArr){
  const alerts=[];
  if(document.getElementById('pl-vehicle')?.value === 'scooter') alerts.push({id: 'scooter-warn', type: 'warn', wpIdx: 0, msg: '⚠️ Bạn đang đi xe máy. Hãy chú ý các trạm đổ xăng và chuẩn bị áo mưa.'});
  wData.forEach((wd,i)=>{
    const hi=hArr[i]; if(hi === -1 || hi === undefined || !wd?.hourly) return;
    const code=wd.hourly.weathercode?.[hi]||0, rain=wd.hourly.precipitation_probability?.[hi]||0, temp=wd.hourly.temperature_2m?.[hi]||26, wind=wd.hourly.windspeed_10m?.[hi]||0;
    const lbl=i===0?'Xuất phát':i===wps.length-1?'Điểm đến':`Điểm ${i}`, info=wmo(code);
    if(SEVERE.has(code)) alerts.push({id:`s${i}${code}`,type:'danger',msg:`${info.e} ${info.v} tại ${lbl}`,wpIdx:i});
    if(rain>70&&!SEVERE.has(code)) alerts.push({id:`r${i}`,type:'warn',msg:`💧 Xác suất mưa ${rain}% tại ${lbl}`,wpIdx:i});
    if(temp>=35) alerts.push({id:`t${i}`,type:'warn',msg:`🌡️ Nhiệt độ cực cao ${temp.toFixed(0)}°C tại ${lbl}`,wpIdx:i});
    if(wind>60) alerts.push({id:`w${i}`,type:'warn',msg:`💨 Gió mạnh ${wind} km/h tại ${lbl}`,wpIdx:i});
  });
  return alerts;
}

function renderAlerts(alerts){ const el=document.getElementById('alert-list'); if(!el) return; el.innerHTML=alerts.length?alerts.map(a=>`<div class="alert-item ${a.type==='danger'?'danger':'warn'}" id="al-${a.id}"><span style="flex:1">${a.msg}</span><button class="alert-dismiss" onclick="document.getElementById('al-${a.id}').remove()">✕</button></div>`).join(''):''; }

async function buildAlternativeRoute(startC,endC,wps,wData,hArr,date,hour){
  let worstI=0,worstSev=-1;
  wData.forEach((wd,i)=>{ const hi=hArr[i]; if(hi === -1 || hi === undefined || !wd?.hourly) return; const sev=wmo(wd.hourly.weathercode?.[hi]||0).s; if(sev>worstSev){ worstSev=sev; worstI=i; } });
  const via={lat:wps[worstI].lat+(endC.lon-startC.lon)*0.2,lon:wps[worstI].lon-(endC.lat-startC.lat)*0.2};
  const altRt=await fetchOSRM([startC,via,endC]);
  if(document.getElementById('pl-vehicle')?.value !== 'car') altRt.dur *= 1.2; 
  const altWps=extractWaypoints(altRt.geometry,8); const altWDat=await Promise.all(altWps.map(w=>fetchWeather(w.lat,w.lon))); const altHArr=altWDat.map(w=>hourIdx(w?.hourly?.time,date,hour));
  state.altRoute=altRt; state.altWps=altWps; state.altWeather=altWDat; state.altHIdxArr=altHArr; drawRoutePolyline(altRt,true);
}

function toggleAlt(){
  state.viewAlt=!state.viewAlt; const btn=document.getElementById('btn-alt');
  if(state.viewAlt){ drawWaypointMarkers(state.altWps,state.altWeather,state.altHIdxArr,true); if(btn) btn.textContent='👁️ Đang xem tuyến đường An Toàn'; }
  else{ drawWaypointMarkers(state.waypoints,state.weather,state.hIdxArr,false); if(btn) btn.textContent='🔀 Xem tuyến đường An Toàn'; }
}

function drawRoutePolyline(rt,isAlt){
  const ref=isAlt?altRouteLayer:routeLayer; if(ref) map.removeLayer(ref);
  const poly=L.polyline(rt.geometry.map(c=>[c[1],c[0]]),{color:isAlt?'#f0a730':'var(--jade)',weight:isAlt?3:5,opacity:isAlt?0.65:0.9,dashArray:isAlt?'10,7':null}).addTo(map);
  if(isAlt) altRouteLayer=poly; else{ routeLayer=poly; map.fitBounds(poly.getBounds(),{padding:[50,50]}); }
}

function drawWaypointMarkers(wps,wData,hArr,isAlt){
  markersList.forEach(m=>map.removeLayer(m)); markersList=[];
  wps.forEach((wp,i)=>{
    const wd=wData[i], hi=hArr[i]; if(!wd?.hourly) return;
    let info, temp, rain, wind; 
    if (hi === -1 || hi === undefined) { info = { e: '❓', v: 'Ngoài tầm dự báo', s: 0 }; temp = null; rain = '--'; wind = '--'; } 
    else { info=wmo(wd.hourly.weathercode?.[hi]||0); temp=wd.hourly.temperature_2m?.[hi]; rain=wd.hourly.precipitation_probability?.[hi]||0; wind=wd.hourly.windspeed_10m?.[hi]||0; }
    const isStart=i===0,isEnd=i===wps.length-1;
    const bg=(hi === -1 || hi === undefined) ? 'var(--dim)' : (isAlt&&!isStart&&!isEnd?'#f0a730':isStart?'var(--jade)':isEnd?'#8b5cf6':SEV_COLORS[info.s]);
    const badge=isStart?`<div style="position:absolute;bottom:-4px;right:-4px;font-size:13px;filter:drop-shadow(0 2px 2px rgba(0,0,0,.3))">🚀</div>`:isEnd?`<div style="position:absolute;bottom:-4px;right:-4px;font-size:13px;filter:drop-shadow(0 2px 2px rgba(0,0,0,.3))">🏁</div>`:'';
    const html=`<div style="width:40px;height:40px;border-radius:50%;background:${bg};border:2px solid var(--bg2);display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 0 12px ${bg}99;cursor:pointer;position:relative;">${info.e}${badge}</div>`;
    const icon=L.divIcon({html,className:'',iconSize:[40,40],iconAnchor:[20,20]});
    const popup=`<div style="font-family:'Rajdhani',sans-serif;min-width:165px;font-size:13px"><b style="color:${bg}">${isStart?'🚀 Xuất phát':isEnd?'🏁 Điểm đến':`${isAlt?'Alt ':''}Điểm ${i}`}</b><br><span style="font-size:22px">${info.e}</span><b style="color:var(--txt)"> ${info.v}</b><br><span style="color:var(--dim)">Nhiệt độ:</span><span style="color:var(--gold);font-family:'JetBrains Mono',monospace"> ${temp!=null?temp.toFixed(1):'--'}°C</span><br><span style="color:var(--dim)">Xác suất mưa:</span><span style="color:var(--sky);font-family:'JetBrains Mono',monospace"> ${rain}%</span><br><span style="color:var(--dim)">Gió:</span><span style="color:#a78bfa;font-family:'JetBrains Mono',monospace"> ${wind} km/h</span><br><span style="color:var(--dim)">Mức độ:</span><span style="color:${SEV_COLORS[info.s]};font-family:'JetBrains Mono',monospace"> ${info.s}/5</span></div>`;
    markersList.push(L.marker([wp.lat,wp.lon],{icon}).addTo(map).bindPopup(popup,{className:''}));
  });
  updateSliderWx(wData,hArr);
}

/* ────────────────────────────────────────────────────────────────────────────
   §11 TRIP PLANNER UI
──────────────────────────────────────────────────────────────────────────── */
let dests=[], destId=0, dragIndex=null;
function initPlanner(){ const td=todayStr(); const dp=document.getElementById('pl-date'); if(dp){ dp.value=td; dp.min=td; dp.max=addDays(td,8); } renderDestList(); }
function addDest(place='',stayDays=2){ dests.push({id:++destId,place:place||'',stayDays}); renderDestList(); }
function removeDest(id){ dests=dests.filter(d=>d.id!==id); renderDestList(); }
function renderDestList(){
  document.getElementById('dest-list').innerHTML=dests.map((d,i)=>`<div class="dest-item" draggable="true" data-index="${i}" ondragstart="onDragStart(event,${i})" ondragover="onDragOver(event)" ondragenter="onDragEnter(event,this)" ondragleave="onDragLeave(event,this)" ondrop="onDrop(event,${i})" ondragend="onDragEnd(event,this)"><div class="dest-head"><div class="drag-handle" title="Kéo thả">☰</div><div class="dest-num">${i+1}</div><div class="dest-lbl">Điểm đến ${i+1}</div><button class="dest-del" onclick="removeDest(${d.id})" title="Xóa">✕</button></div><div class="form-grp"><label class="form-lbl">Địa điểm</label><input type="text" class="form-ctrl" value="${d.place}" placeholder="Nhập địa chỉ chi tiết hoặc tên tỉnh" onchange="dests.find(x=>x.id===${d.id}).place=this.value"></div><div class="form-grp"><label class="form-lbl">📅 Số ngày lưu trú</label><input type="number" class="form-ctrl" min="1" max="14" value="${d.stayDays}" onchange="dests.find(x=>x.id===${d.id}).stayDays=+this.value"></div></div>`).join('');
}
function onDragStart(e,index){ dragIndex=index; e.dataTransfer.effectAllowed='move'; setTimeout(()=>e.target.classList.add('dragging'),0); }
function onDragOver(e){ e.preventDefault(); e.dataTransfer.dropEffect='move'; }
function onDragEnter(e,el){ e.preventDefault(); if(!el.classList.contains('dragging')) el.classList.add('drag-over'); }
function onDragLeave(e,el){ el.classList.remove('drag-over'); }
function onDrop(e,targetIndex){ e.preventDefault(); e.currentTarget.classList.remove('drag-over'); if(dragIndex!==null&&dragIndex!==targetIndex){ const moved=dests.splice(dragIndex,1)[0]; dests.splice(targetIndex,0,moved); renderDestList(); } }
function onDragEnd(e,el){ el.classList.remove('dragging'); dragIndex=null; document.querySelectorAll('.dest-item').forEach(item=>item.classList.remove('drag-over')); }

function resetTrip(){
  if(routeLayer){ map.removeLayer(routeLayer); routeLayer=null; } if(altRouteLayer){ map.removeLayer(altRouteLayer); altRouteLayer=null; }
  if(window.tempMarker){ map.removeLayer(window.tempMarker); window.tempMarker=null; }
  markersList.forEach(m=>map.removeLayer(m)); markersList=[];
  state={ route:null, waypoints:[], weather:[], hIdxArr:[], altRoute:null, altWps:[], altWeather:[], altHIdxArr:[], selectedHour:8, departDate:todayStr(), viewAlt:false, selectedDay:0, currentViewDate:null, totalTripDays:0 };
  ['route-result','map-overlay','pl-err','btn-alt'].forEach(id=>document.getElementById(id)?.classList.add('hidden'));
  document.getElementById('time-bar')?.classList.remove('visible');
  const td=todayStr(); const dp=document.getElementById('pl-date'); if(dp) dp.value=td;
  ['pl-hour','pl-vehicle'].forEach(id=>{const el=document.getElementById(id); if(el) el.value=id==='pl-hour'?'8':'car';});
  const daySl=document.getElementById('day-slider'); if(daySl){ daySl.value=0; daySl.max=7; _setDayGradient(daySl,0,7); } _updateDayLabel(0);
  const hrSl=document.getElementById('hour-slider'); if(hrSl){ hrSl.value=8; _setHourGradient(hrSl,8); } document.getElementById('tb-val').textContent='08:00';
  document.getElementById('welcome')?.classList.remove('hidden'); showToast('🔄 Đã làm mới lịch trình','info');
}

async function geolocateStart(){
  const btn=document.getElementById('geo-btn'), input=document.getElementById('pl-from');
  if(!navigator.geolocation){ showToast('⚠️ Trình duyệt không hỗ trợ định vị','warn'); return; }
  btn.classList.add('loading'); btn.innerHTML='<div class="geo-spin"></div>';
  navigator.geolocation.getCurrentPosition(
    async(pos)=>{
      try{
        const res=await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json&accept-language=vi`,{headers:{'User-Agent':'SmartRoute-VN/1.0'}});
        const data=await res.json(); input.value=(data.display_name||'').split(',').slice(0,3).join(',').trim()||`${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`;
        input.focus(); showToast(`📍 Đã xác định: ${input.value}`,'info');
      }catch(e){ input.value=`${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`; }
      finally{ btn.classList.remove('loading'); btn.innerHTML='📍'; }
    },
    (err)=>{ btn.classList.remove('loading'); btn.innerHTML='📍'; showToast('⚠️ Lỗi định vị', 'warn'); },
    {enableHighAccuracy:true,timeout:8000,maximumAge:30000}
  );
}

function wmoScore(code,rain,tempMax,wind){ const info=wmo(code); let s=100 - info.s*13 - (rain||0)*0.35 - Math.max(0,(tempMax||26)-36)*4 - Math.max(0,(wind||0)-40)*0.3; return Math.max(0,Math.min(100,s)); }
function scoreCol(s){ return s>=80?'var(--ok)':s>=60?'#84cc16':s>=40?'var(--gold)':s>=20?'var(--warn)':'var(--danger)'; }

async function analyzeTrip(){
  const fromStr=document.getElementById('pl-from').value.trim(), dateStr=document.getElementById('pl-date').value, hour=+document.getElementById('pl-hour').value, vehicle=document.getElementById('pl-vehicle').value, errEl=document.getElementById('pl-err'), btn=document.getElementById('plan-btn');
  errEl.classList.add('hidden');
  if(!fromStr){ showErr('Vui lòng nhập điểm xuất phát'); return; } if(!dateStr){ showErr('Vui lòng chọn ngày khởi hành'); return; }
  const validDests=dests.filter(d=>d.place.trim()); if(!validDests.length){ showErr('Vui lòng thêm ít nhất 1 điểm đến'); return; }

  btn.disabled=true; btn.innerHTML=`<span class="spinner" style="border-top-color:var(--bg)"></span> Đang phân tích…`; document.getElementById('sb-overlay')?.classList.remove('hidden');

  try{
    const stops=[fromStr,...validDests.map(d=>d.place)], coords=await Promise.all(stops.map(s=>geocode(s))), wxAll=await Promise.all(coords.map(c=>fetchWeather(c.lat,c.lon)));
    const mainRt=await fetchOSRM(coords); if(vehicle !== 'car') mainRt.dur *= 1.2; 
    const mainWps=extractWaypoints(mainRt.geometry,Math.min(8,coords.length*2)), mainWDat=await Promise.all(mainWps.map(w=>fetchWeather(w.lat,w.lon))), mainHArr=mainWDat.map(w=>hourIdx(w?.hourly?.time,dateStr,hour));

    state.route=mainRt; state.waypoints=mainWps; state.weather=mainWDat; state.hIdxArr=mainHArr; state.departDate=dateStr; state.selectedHour=hour; state.viewAlt=false; state.currentViewDate=dateStr; state.selectedDay=0;
    if (window.tempMarker) map.removeLayer(window.tempMarker);
    drawRoutePolyline(mainRt,false); drawWaypointMarkers(mainWps,mainWDat,mainHArr,false); document.getElementById('welcome')?.classList.add('hidden');

    const legs=[], [dY,dM,dD]=dateStr.split('-').map(Number); let currentDateObj=new Date(dY,dM-1,dD,0,0,0);
    for(let i=0;i<coords.length-1;i++){
      const fromCoord=coords[i], toCoord=coords[i+1], stayDays=i===0?0:validDests[i-1].stayDays; currentDateObj.setDate(currentDateObj.getDate()+stayDays);
      const depY=currentDateObj.getFullYear(), depM=String(currentDateObj.getMonth()+1).padStart(2,'0'), depD=String(currentDateObj.getDate()).padStart(2,'0'), depDateStr=`${depY}-${depM}-${depD}`;
      let legRt=null; try{ legRt=await fetchOSRM([fromCoord,toCoord]); if(legRt && vehicle !== 'car') legRt.dur *= 1.2; }catch(_){}
      const legWps = legRt ? extractWaypoints(legRt.geometry, 5) : [fromCoord, toCoord];
      const legWx = legRt ? await Promise.all(legWps.map(w => fetchWeather(w.lat, w.lon))) : [wxAll[i], wxAll[i+1]];

      let bestHour=8,bestHourScore=-1,bestHourInfo={code:-1,rain:'--',temp:null,wind:'--',score:-1, details:[]};
      for(let h=6;h<=17;h++){
        let minScore=100, worstCode=-1, worstRain=0, worstTemp=26, worstWind=0, hasValidData=false, pathWx=[];
        for(let k=0; k<legWps.length; k++){
            const wx=legWx[k], progress=legWps.length>1?k/(legWps.length-1):0, etaDateObj=new Date(depY, currentDateObj.getMonth(), currentDateObj.getDate(), h, 0, 0);
            etaDateObj.setMinutes(etaDateObj.getMinutes() + Math.round(legRt?legRt.dur*progress:0));
            const tIdx=hourIdx(wx?.hourly?.time, `${etaDateObj.getFullYear()}-${String(etaDateObj.getMonth()+1).padStart(2,'0')}-${String(etaDateObj.getDate()).padStart(2,'0')}`, etaDateObj.getHours());
            if(tIdx !== -1 && wx) {
                hasValidData = true;
                const code=wx.hourly.weathercode?.[tIdx]||0, rain=wx.hourly.precipitation_probability?.[tIdx]||0, temp=wx.hourly.temperature_2m?.[tIdx]||26, wind=wx.hourly.windspeed_10m?.[tIdx]||0, score=wmoScore(code, rain, temp, wind);
                pathWx.push({ pct: Math.round(progress * 100), time: `${String(etaDateObj.getHours()).padStart(2,'0')}:${String(etaDateObj.getMinutes()).padStart(2,'0')}`, code, rain, temp, wind });
                if(score<=minScore) { minScore=score; worstCode=code; worstRain=rain; worstTemp=temp; worstWind=wind; }
            }
        }
        if(hasValidData && minScore>bestHourScore) { bestHourScore=minScore; bestHour=h; bestHourInfo={code:worstCode, rain:worstRain, temp:worstTemp, wind:worstWind, score:minScore, details: pathWx}; }
      }
      let depDateTime=new Date(depY,currentDateObj.getMonth(),currentDateObj.getDate(),bestHour,0,0), arrDateTime=new Date(depDateTime.getTime());
      if(legRt) arrDateTime.setMinutes(arrDateTime.getMinutes()+Math.round(legRt.dur));
      legs.push({fromName:stops[i],toName:stops[i+1],depDateStr,depDateTime,arrDateTime,legRt,bestHour,bestHourInfo,stayDays});
      currentDateObj=new Date(arrDateTime.getFullYear(),arrDateTime.getMonth(),arrDateTime.getDate(),0,0,0);
    }

    const alerts=detectAnomalies(mainWDat,mainWps,mainHArr); renderAlerts(alerts);
    let altBuilt=false;
    if(alerts.some(a=>a.type==='danger')){ try{ await buildAlternativeRoute(coords[0],coords[coords.length-1],mainWps,mainWDat,mainHArr,dateStr,hour); altBuilt=true; drawRoutePolyline(state.altRoute,true); }catch(e){} }
    initDualSliders(legs); renderRouteResult(mainRt,mainWDat,mainHArr,altBuilt,legs,stops);
  }catch(err){ showErr(err.message); }finally{ btn.disabled=false; btn.innerHTML='🚀 Phân Tích'; document.getElementById('sb-overlay')?.classList.add('hidden'); hideLoader(); }
}

function renderRouteResult(rt,wData,hArr,altBuilt,legs,stops){
  document.getElementById('route-result').classList.remove('hidden');
  const mw=calcRouteWeight(rt.dist,wData,hArr), aw=state.altRoute?calcRouteWeight(state.altRoute.dist,state.altWeather,state.altHIdxArr):null, altBetter=aw!=null&&aw<mw, saving=altBetter?((mw-aw)/mw*100).toFixed(0):0;
  document.getElementById('route-stats').innerHTML=`<div class="stat-row"><div class="stat-cell"><div class="lbl">Tổng quãng đường</div><div class="val" style="color:var(--jade)">${rt.dist.toFixed(1)} km</div></div><div class="stat-cell"><div class="lbl">Thời gian</div><div class="val" style="color:#8b5cf6">${Math.round(rt.dur)} phút</div></div><div class="stat-cell"><div class="lbl">Điểm kiểm tra</div><div class="val" style="color:var(--sky)">${state.waypoints.length}</div></div><div class="stat-cell"><div class="lbl">Trọng số W</div><div class="val" style="color:${mw>300?'var(--danger)':mw>150?'var(--gold)':'var(--ok)'}">${mw.toFixed(0)}</div></div></div>`;

  if(aw!=null){
    document.getElementById('route-cards').innerHTML=`<div class="route-card primary"><div class="rc-head"><span class="rc-label" style="color:var(--jade)">🛣️ Tuyến Chính</span><span class="rc-badge" style="background:var(--jade-g);color:var(--jade)">CHỦ ĐẠO</span></div><div style="font-size:11px;color:var(--muted)">Khoảng cách: ${rt.dist.toFixed(1)} km · Trọng số W: <b style="color:var(--jade)">${mw.toFixed(0)}</b></div></div><div class="route-card alt"><div class="rc-head"><span class="rc-label" style="color:var(--gold)">🔀 Tuyến An Toàn</span><span class="rc-badge" style="background:rgba(240,167,48,.15);color:var(--gold)">${altBetter?'AN TOÀN HƠN':'THAY THẾ'}</span></div><div style="font-size:11px;color:var(--muted)">Khoảng cách: ${state.altRoute.dist.toFixed(1)} km · Trọng số W: <b style="color:var(--gold)">${aw.toFixed(0)}</b></div>${altBetter?`<div style="margin-top:6px;font-size:11px;color:var(--ok)">✅ An toàn hơn ${saving}% (thêm ${(state.altRoute.dist-rt.dist).toFixed(1)} km)</div>`:''}</div>`;
    document.getElementById('btn-alt')?.classList.remove('hidden');
  }else{ document.getElementById('route-cards').innerHTML=''; }

  if(legs&&legs.length){
    let tlHtml='<div class="timeline">';
    for(let i=0;i<stops.length;i++){
      const isStart=i===0,isEnd=i===stops.length-1, outLeg=isEnd?null:legs[i], inLeg=isStart?null:legs[i-1];
      tlHtml+=`<div class="tl-node"><div class="tl-marker" style="border-color:${isStart?'var(--jade)':isEnd?'#8b5cf6':'var(--gold)'};background:${isStart?'var(--jade-g)':isEnd?'rgba(139,92,246,.15)':'rgba(240,167,48,.15)'}">${isStart?'🚀':isEnd?'🏁':'🏕️'}</div><div class="tl-content"><div class="tl-header"><div class="tl-title" style="word-break: break-word">${stops[i]}</div></div>`;
      if(!isStart&&inLeg) tlHtml+=`<div style="font-size:12px;color:var(--txt);font-weight:600;display:flex;align-items:center;gap:6px;"><span style="color:#8b5cf6;font-size:14px">🛬</span> Đã đến: <span style="font-family:'JetBrains Mono',monospace;color:var(--jade)">${inLeg.arrDateTime.toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})} · ${String(inLeg.arrDateTime.getDate()).padStart(2,'0')}-${String(inLeg.arrDateTime.getMonth()+1).padStart(2,'0')}</span></div>`;
      if(!isStart&&!isEnd&&outLeg&&outLeg.stayDays>0) tlHtml+=`<div style="margin:10px 0;border-top:1px dashed var(--brd2);border-bottom:1px dashed var(--brd2);padding:8px 0;font-size:11px;color:var(--muted);font-weight:600;display:flex;align-items:center;gap:6px;"><span>🛌</span> Lưu trú <b style="color:var(--gold);font-size:12px">${outLeg.stayDays}</b> ngày</div>`; else if(!isStart&&!isEnd) tlHtml+=`<div style="margin:10px 0;border-top:1px dashed var(--brd2);"></div>`;
      if(!isEnd&&outLeg){
        const bh=outLeg.bestHourInfo, bhInfo = bh.score === -1 ? {e: '❓', v: 'Chưa có dự báo'} : wmo(bh.code), col = bh.score === -1 ? 'var(--dim)' : scoreCol(bh.score);
        let detailsHtml = '';
        if(bh.details && bh.details.length > 0) {
            detailsHtml += `<button class="tl-detail-btn" onclick="this.nextElementSibling.classList.toggle('show')">🌤️ Xem biến động dọc đường ▾</button><div class="tl-detail-box"><div style="font-size:9px; color:var(--dim); margin-bottom:8px; font-weight:800; text-transform:uppercase;">Dự báo chi tiết:</div>`;
            bh.details.forEach(dt => { const dInfo = wmo(dt.code); detailsHtml += `<div class="tl-step"><div class="tl-step-time">${dt.time}</div><div class="tl-step-icon">${dInfo.e}</div><div class="tl-step-info"><b style="color:var(--txt)">${dt.pct === 0 ? 'Lúc xuất phát' : dt.pct === 100 ? 'Lúc đến nơi' : `Hoàn thành ${dt.pct}%`}</b><br>${dInfo.v}, <span style="color:var(--gold);font-family:'JetBrains Mono',monospace">${Math.round(dt.temp)}°C</span>, Mưa <span style="color:${dt.rain>50?'var(--warn)':'var(--sky)'};font-family:'JetBrains Mono',monospace">${dt.rain}%</span></div></div>`; });
            detailsHtml += `</div>`;
        }
        tlHtml+=`<div style="font-size:11px;font-weight:700;color:var(--dim);text-transform:uppercase;margin-bottom:6px;margin-top:${isStart?'0':'8px'}">🚀 Khởi hành đi chặng tiếp theo</div><div class="tl-recommend" style="border-left:3px solid ${col};margin-top:0;"><div><div class="tl-rec-time" style="color:${col}">${String(outLeg.bestHour).padStart(2,'0')}:00</div><div style="font-size:10px;font-weight:700;color:var(--dim);margin-top:2px;text-align:center;font-family:'JetBrains Mono',monospace">${String(outLeg.depDateTime.getDate()).padStart(2,'0')}-${String(outLeg.depDateTime.getMonth()+1).padStart(2,'0')}</div></div><div class="tl-rec-text"><span style="font-size:14px; filter:${bh.score===-1?'grayscale(1)':'none'}">${bhInfo.e}</span> <b style="color:${bh.score===-1?'var(--dim)':'inherit'}">${bh.score===-1?'Quá 15 ngày':bh.score>=80?'Thời tiết lý tưởng':bh.score>=50?'Thời tiết ổn định':'Thời tiết xấu, chú ý'}</b><br><span style="font-size:10px;opacity:.8">${bh.score===-1?'An toàn: --/100 · 💧 Mưa: --%':`An toàn: ${Math.round(bh.score)}/100 · 💧 ${bh.rain}%`}</span><br>${detailsHtml}</div></div>`;
      }
      if(isEnd) tlHtml+=`<div style="margin-top:12px;font-size:12px;color:#047857;font-weight:700;display:inline-flex;align-items:center;gap:6px;background:#ecfdf5;padding:6px 12px;border-radius:6px;border:1px solid #a7f3d0">🎉 Kết thúc hành trình</div>`;
      tlHtml+=`</div>`;
      if(!isEnd&&outLeg&&outLeg.legRt) tlHtml+=`<div class="tl-path-info" style="margin-top:12px;margin-bottom:4px;padding:6px 14px;"><span>🛣️ ${outLeg.legRt.dist.toFixed(0)} km</span><span style="color:var(--brd2);margin:0 4px">|</span><span>⏱️ ${Math.floor(outLeg.legRt.dur/60)>0?`${Math.floor(outLeg.legRt.dur/60)}h ${Math.round(outLeg.legRt.dur%60)}m`:`${Math.round(outLeg.legRt.dur%60)} phút`}</span></div>`;
      tlHtml+=`</div>`;
    }
    document.getElementById('route-cards').innerHTML+=`<div class="s-lbl" style="margin-top:14px;margin-bottom:12px">🧭 Lộ Trình Trực Quan</div>${tlHtml}</div>`;
  }
  showOverlay("Điểm Xuất Phát", "Điểm Cuối Cùng",rt.dist,rt.dur);
}

function showErr(msg){ const el=document.getElementById('pl-err'); el.className='err-box'; el.innerHTML=`⚠️ ${msg}`; el.classList.remove('hidden'); }

async function showSidebarWeather(name, coords, fullAddress = ''){
  const hint=document.getElementById('map-hint'), wx=document.getElementById('map-wx'), displayAddr = fullAddress ? fullAddress : `${coords.lat.toFixed(3)}°N · ${coords.lon.toFixed(3)}°E`;
  hint.classList.add('hidden'); wx.classList.remove('hidden');
  wx.innerHTML=`<div style="display:flex;align-items:center;gap:10px;padding-bottom:12px;margin-bottom:12px;border-bottom:1px solid var(--brd)"><div style="width:34px;height:24px;background:var(--red);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">📍</div><div><div style="font-size:15px;font-weight:800">${name}</div><div style="font-size:10px;color:var(--dim);font-family:'Rajdhani',sans-serif">${displayAddr}</div></div></div><div class="skel" style="height:90px;margin-bottom:12px"></div><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:12px">${Array(14).fill('<div class="skel" style="min-width:42px;height:72px;border-radius:8px"></div>').join('')}</div>`;
  try{ renderSidebarWx(name, coords, await fetchWeather(coords.lat,coords.lon), fullAddress); }catch(err){ wx.innerHTML+=`<div class="err-box">⚠️ ${err.message}</div>`; }
}

let _sbWx=null,_sbDays=[],_sbSelDay=0;
function renderSidebarWx(name, coords, wxData, fullAddress = ''){
  _sbWx=wxData; _sbDays=getDays(wxData); _sbSelDay=0; if(!_sbDays.length) return;
  const d0=_sbDays[0], info=wmo(d0.code), sc=wmoScore(d0.code,d0.rain,d0.hi,d0.wind), displayAddr = fullAddress ? fullAddress : `${coords.lat.toFixed(3)}°N · ${coords.lon.toFixed(3)}°E`, passValue = fullAddress ? fullAddress : name;
  document.getElementById('map-wx').innerHTML=`<div style="display:flex;align-items:center;gap:10px;padding-bottom:12px;margin-bottom:12px;border-bottom:1px solid var(--brd);animation:fadeIn .25s"><div style="width:34px;height:24px;background:var(--red);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;box-shadow:0 2px 8px rgba(224,48,48,.3)">📍</div><div style="flex:1"><div style="font-size:15px;font-weight:800">${name}</div><div style="font-size:10px;color:var(--dim);font-family:'Rajdhani',sans-serif;margin-top:1px">${displayAddr}</div></div></div><div style="background:linear-gradient(135deg,var(--surf2),var(--surf));border:1px solid var(--brd2);border-radius:12px;padding:14px;margin-bottom:12px;display:flex;gap:12px;align-items:center;animation:fadeUp .25s"><div style="font-size:52px;line-height:1;flex-shrink:0">${info.e}</div><div style="flex:1"><div style="font-size:38px;font-weight:800;font-family:'JetBrains Mono',monospace;line-height:1">${Math.round(d0.hi)}<span style="font-size:18px;font-weight:400;color:var(--muted)">°C</span></div><div style="font-size:12px;color:var(--muted);margin-top:2px">${info.v}</div><div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:6px"><span style="font-size:10px;color:var(--dim);background:var(--surf3);border:1px solid var(--brd);padding:2px 7px;border-radius:100px">⬇️ ${Math.round(d0.lo)}°C</span><span style="font-size:10px;color:var(--dim);background:var(--surf3);border:1px solid var(--brd);padding:2px 7px;border-radius:100px">💧 ${d0.rain}%</span><span style="font-size:10px;color:var(--dim);background:var(--surf3);border:1px solid var(--brd);padding:2px 7px;border-radius:100px">💨 ${d0.wind}km/h</span></div></div><div style="display:flex;flex-direction:column;align-items:center;background:var(--surf3);border:1px solid var(--brd2);border-radius:9px;padding:8px 10px;flex-shrink:0;min-width:56px;text-align:center"><div style="font-size:20px;font-weight:800;color:${scoreCol(sc)};font-family:'JetBrains Mono',monospace">${Math.round(sc)}</div><div style="font-size:8px;color:var(--dim);text-transform:uppercase;margin-top:2px">Du lịch</div></div></div><div style="display:flex;gap:8px;margin-bottom:16px;animation:fadeUp .3s ease"><button class="btn btn-jade" style="flex:1;padding:8px;font-size:12px;margin-bottom:0" onclick="startTripFromMap('${passValue}')">🚀 Bắt đầu từ đây</button><button class="btn btn-ghost" style="flex:1;padding:8px;font-size:12px;margin-bottom:0;background:var(--surf);border-color:var(--brd2)" onclick="addDestFromMap('${passValue}')">➕ Thêm điểm đến</button></div><div style="font-size:9px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.14em;margin-bottom:8px;display:flex;align-items:center;gap:7px">Dự báo 14 ngày<span style="flex:1;height:1px;background:var(--brd);display:block"></span></div><div id="sb-days-strip" style="display:grid; grid-template-columns:repeat(7,1fr); gap:6px 4px; margin-bottom:16px;">${_sbDays.slice(0,14).map((d,i)=>`<div onclick="sbSelectDay(${i})" id="sbd-${i}" style="background:${i===0?'var(--jade-g)':'var(--surf)'};border:1px solid ${i===0?'var(--jade)':'var(--brd)'};border-radius:8px;padding:6px 2px;text-align:center;cursor:pointer;transition:all .15s;position:relative;overflow:hidden;"><div style="font-size:8px;font-weight:700;color:var(--dim);text-transform:uppercase">${i===0?'HN':dayVN(d.date)}</div><div style="font-size:8px;color:var(--dim);margin-bottom:3px">${fmtDate(d.date)}</div><span style="font-size:17px;display:block;margin:2px 0">${wmo(d.code).e}</span><div style="font-size:10px;font-weight:700;color:var(--gold);font-family:'JetBrains Mono',monospace">${Math.round(d.hi)}°</div><div style="font-size:9px;color:var(--dim);font-family:'JetBrains Mono',monospace">${Math.round(d.lo)}°</div><div style="font-size:8px;color:${d.rain>60?'var(--warn)':'var(--sky)'};margin-top:2px">${d.rain}%</div>${i===0?`<div style="position:absolute;bottom:0;left:10%;right:10%;height:2px;background:var(--jade);border-radius:1px" data-bar="1"></div>`:''}</div>`).join('')}</div><div id="sb-hourly-wrap"></div>`;
  sbRenderHourly(_sbDays[0].date);
}

function sbSelectDay(idx){
  _sbSelDay=idx;
  for(let i=0;i<14;i++){ const el=document.getElementById(`sbd-${i}`); if(!el) continue; el.style.border=`1px solid ${i===idx?'var(--jade)':'var(--brd)'}`; el.style.background=i===idx?'var(--jade-g)':'var(--surf)'; const bar=el.querySelector('[data-bar]'); if(bar) bar.remove(); if(i===idx){ const b=document.createElement('div'); b.setAttribute('data-bar','1'); b.style.cssText='position:absolute;bottom:0;left:10%;right:10%;height:2px;background:var(--jade);border-radius:1px'; el.appendChild(b); } }
  if(_sbDays[idx]) sbRenderHourly(_sbDays[idx].date);
}

function sbRenderHourly(dateStr){
  const h=getHourlySlice(_sbWx,dateStr), el=document.getElementById('sb-hourly-wrap'), dObj = new Date(dateStr), dStr = `${String(dObj.getDate()).padStart(2,'0')}/${String(dObj.getMonth()+1).padStart(2,'0')}`;
  if(!el) return;
  let html = `<div style="font-size:9px;font-weight:700;color:var(--dim);text-transform:uppercase;letter-spacing:.14em;margin-bottom:8px;display:flex;align-items:center;gap:7px">Chi tiết ngày ${dStr}<span style="flex:1;height:1px;background:var(--brd);display:block"></span></div>`;
  if(!h){ html += '<div style="text-align:center;color:var(--dim);padding:12px;font-size:12px;background:var(--surf2);border-radius:8px;border:1px dashed var(--brd2)">Chưa có dữ liệu dự báo giờ cho ngày này</div>'; el.innerHTML = html; return; }
  html += `<div style="display:flex; gap:6px; justify-content:space-between">`;
  [{ t: '06:00', l: 'Sáng' },{ t: '10:00', l: 'Trưa' },{ t: '14:00', l: 'Chiều' },{ t: '18:00', l: 'Tối' },{ t: '22:00', l: 'Đêm' }].forEach(slot => {
     const idx = h.labels.indexOf(slot.t);
     if (idx !== -1) { const info = wmo(h.code[idx]); html += `<div style="flex:1; background:var(--surf); border:1px solid var(--brd2); border-radius:9px; padding:10px 4px; text-align:center; box-shadow:0 2px 8px rgba(0,0,0,.02); animation:fadeUp .2s ease"><div style="font-size:9px; font-weight:800; color:var(--dim); text-transform:uppercase;">${slot.l}</div><div style="font-size:10px; color:var(--muted); font-family:'JetBrains Mono',monospace; margin-bottom:6px">${slot.t}</div><div style="font-size:22px; line-height:1; margin-bottom:6px; filter:drop-shadow(0 2px 4px rgba(0,0,0,.1))">${info.e}</div><div style="font-size:12px; font-weight:800; color:var(--gold); font-family:'JetBrains Mono',monospace">${h.temp[idx]!=null?Math.round(h.temp[idx])+'°':'--'}</div><div style="font-size:10px; font-weight:700; color:${h.rain[idx]>50?'var(--warn)':'var(--sky)'}; margin-top:2px">💧 ${h.rain[idx]}%</div></div>`; } 
     else { html += `<div style="flex:1; background:var(--surf); border:1px dashed var(--brd2); border-radius:9px; padding:10px 4px; text-align:center; opacity:0.6"><div style="font-size:9px; font-weight:800; color:var(--dim); text-transform:uppercase">${slot.l}</div><div style="font-size:10px; color:var(--muted); font-family:'JetBrains Mono',monospace; margin-bottom:6px">${slot.t}</div><div style="font-size:22px; line-height:1; margin:6px 0">❓</div></div>`; }
  });
  el.innerHTML = html + `</div>`;
}

let currentTab='map';
function startTripFromMap(value){ const fromInput=document.getElementById('pl-from'); if(fromInput){ fromInput.value=value; switchTab('planner'); showToast(`📍 Đã chọn điểm xuất phát từ bản đồ`,'info'); fromInput.style.transition='box-shadow .3s ease'; fromInput.style.boxShadow='0 0 0 4px var(--jade-g)'; setTimeout(()=>fromInput.style.boxShadow='none',1000); } }
function addDestFromMap(value){ addDest(value,2); showToast(`✅ Đã thêm địa điểm vào lộ trình`); switchTab('planner'); }
function switchTab(tab){ currentTab=tab; document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active')); document.getElementById(`tab-${tab}`).classList.add('active'); document.getElementById('sb-map').classList.toggle('hidden',tab!=='map'); document.getElementById('sb-planner').classList.toggle('hidden',tab!=='planner'); if(tab==='map'&&!selProv) document.getElementById('map-hint').classList.remove('hidden'); }
function showLoader(txt){ document.getElementById('loader-txt').textContent=txt||'Đang tải…'; document.getElementById('map-loader').classList.remove('hidden'); }
function hideLoader(){ document.getElementById('map-loader').classList.add('hidden'); }
function showOverlay(from,to,dist,dur){ const el=document.getElementById('map-overlay'); document.getElementById('overlay-content').innerHTML=`<div style="margin-bottom:4px"><b style="color:var(--jade)">${from}</b></div><div style="color:var(--dim);font-size:10px;margin-bottom:4px">→ ${to}</div><div style="display:flex;gap:8px"><span style="color:var(--jade);font-family:'JetBrains Mono',monospace">${dist.toFixed(1)}km</span><span style="color:#8b5cf6;font-family:'JetBrains Mono',monospace">${Math.round(dur)}min</span></div>`; el.classList.remove('hidden'); }
function showToast(msg,type='info'){ const t=document.createElement('div'); t.style.cssText=`position:fixed;bottom:20px;right:20px;z-index:9999;background:${type==='warn'?'rgba(249,115,22,.12)':'var(--surf2)'};border:1px solid ${type==='warn'?'rgba(249,115,22,.4)':'var(--brd2)'};color:${type==='warn'?'#fb923c':'var(--txt)'};padding:10px 16px;border-radius:9px;font-size:12.5px;font-weight:600;font-family:'Rajdhani',sans-serif;animation:fadeUp .3s ease;box-shadow:0 4px 20px rgba(0,0,0,.15);max-width:280px;`; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),300); },3000); }

function shareTrip() {
  const f = document.getElementById('pl-from').value.trim(); if(!f) { showToast('Vui lòng nhập điểm xuất phát trước khi chia sẻ', 'warn'); return; }
  try { const base64Str = btoa(unescape(encodeURIComponent(JSON.stringify({ f, d: document.getElementById('pl-date').value, h: document.getElementById('pl-hour').value, v: document.getElementById('pl-vehicle').value, dst: dests.map(d => ({ p: d.place, s: d.stayDays })) })))); navigator.clipboard.writeText(window.location.origin + window.location.pathname + '?trip=' + base64Str).then(() => showToast('🔗 Đã copy link chia sẻ vào Clipboard!', 'ok')).catch(() => showToast('⚠️ Trình duyệt chặn copy. Link ở thanh địa chỉ của bạn.', 'warn')); } catch(e) { showToast('⚠️ Không thể tạo link chia sẻ', 'danger'); }
}
async function exportTimeline() {
  const btn = document.getElementById('btn-export'), ogText = btn.innerHTML; btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-top-color:var(--dim)"></span> Đang chụp...';
  try { const canvas = await html2canvas(document.getElementById('route-result'), {scale: 2, useCORS: true, backgroundColor: '#f8fafc'}); const link = document.createElement('a'); link.download = `SmartRoute-Timeline-${todayStr()}.png`; link.href = canvas.toDataURL('image/png'); link.click(); showToast('📸 Đã lưu ảnh Timeline thành công!', 'ok'); } catch(e) { showToast('⚠️ Lỗi khi chụp ảnh: ' + e.message, 'danger'); } finally { btn.innerHTML = ogText; }
}

document.addEventListener('DOMContentLoaded', () => {
  const dp = document.getElementById('pl-date'); if (dp) { const td = todayStr(); dp.value = td; dp.min = td; dp.max = addDays(td, 8); }
  initPlanner(); initMap();
  const tripParam = new URLSearchParams(window.location.search).get('trip');
  if (tripParam) {
    try {
      const data = JSON.parse(decodeURIComponent(escape(atob(tripParam))));
      if(data.f) document.getElementById('pl-from').value = data.f; if(data.d) document.getElementById('pl-date').value = data.d; if(data.h) document.getElementById('pl-hour').value = data.h; if(data.v) document.getElementById('pl-vehicle').value = data.v;
      if(data.dst && Array.isArray(data.dst)) { dests = []; destId = 0; data.dst.forEach(d => addDest(d.p, d.s)); renderDestList(); }
      setTimeout(() => { showToast('Khôi phục lộ trình từ link chia sẻ!', 'info'); analyzeTrip(); }, 500);
    } catch(e) { showToast('⚠️ Link chia sẻ không hợp lệ.', 'danger'); }
  }
  const daySl = document.getElementById('day-slider'); if (daySl) _setDayGradient(daySl, 0, 7); _updateDayLabel(0);
  const hrSl = document.getElementById('hour-slider'); if (hrSl) _setHourGradient(hrSl, 8); _renderHourTicks();
});

window.switchTab=switchTab; window.addDest=addDest; window.removeDest=removeDest; window.analyzeTrip=analyzeTrip; window.toggleAlt=toggleAlt; window.sbSelectDay=sbSelectDay; window.resetTrip=resetTrip; window.geolocateStart=geolocateStart; window.startTripFromMap=startTripFromMap; window.addDestFromMap=addDestFromMap; window.shareTrip=shareTrip; window.exportTimeline=exportTimeline;
/* ══════════════════════════════════════════════════════════════
   MOBILE BOTTOM SHEET LOGIC (V3 - FIX LỖI CLICK BẢN ĐỒ)
══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  if (window.innerWidth <= 900) sidebar.classList.add('sheet-hidden');

  if(!document.querySelector('.sheet-handle')){
    const handle = document.createElement('div');
    handle.className = 'sheet-handle';
    sidebar.insertBefore(handle, sidebar.firstChild);

    let startY = 0, currentY = 0;
    handle.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; sidebar.style.transition = 'none'; }, {passive: true});
    
    handle.addEventListener('touchmove', (e) => {
      currentY = e.touches[0].clientY; let diff = currentY - startY;
      if (diff > 0) {
        let baseT = sidebar.classList.contains('sheet-expanded') ? 0 : (window.innerHeight * 0.5);
        sidebar.style.transform = `translateY(calc(${baseT}px + ${diff}px))`;
      }
    }, {passive: true});
    
    handle.addEventListener('touchend', () => {
      sidebar.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
      sidebar.style.transform = '';
      let diff = currentY - startY;
      if (diff > 50) {
        if (sidebar.classList.contains('sheet-expanded')) sidebar.classList.replace('sheet-expanded', 'sheet-peek');
        else sidebar.classList.replace('sheet-peek', 'sheet-hidden');
      } else if (diff < -30) {
        sidebar.classList.remove('sheet-hidden', 'sheet-peek'); sidebar.classList.add('sheet-expanded');
      }
    });
    
    handle.addEventListener('click', () => {
      if (sidebar.classList.contains('sheet-peek')) sidebar.classList.replace('sheet-peek', 'sheet-expanded');
      else if (sidebar.classList.contains('sheet-expanded')) sidebar.classList.replace('sheet-expanded', 'sheet-peek');
    });
  }
});

/* ── GHI ĐÈ LOGIC CHUYỂN TAB VÀ HIỂN THỊ THỜI TIẾT ── */
let isAutoOpening = false; // Cờ chặn xung đột chuyển tab làm ẩn bản đồ

const originalSwitchTab = window.switchTab;
window.switchTab = function(tab) {
  originalSwitchTab(tab);
  if (window.innerWidth <= 900 && !isAutoOpening) {
    const sidebar = document.querySelector('.sidebar');
    if (tab === 'planner') {
      sidebar.classList.remove('sheet-hidden', 'sheet-peek');
      sidebar.classList.add('sheet-expanded');
    } else {
      sidebar.classList.remove('sheet-expanded', 'sheet-peek');
      sidebar.classList.add('sheet-hidden');
    }
  }
};

// Hook trực tiếp vào hàm showSidebarWeather (hàm thực sự được gọi khi bấm vào bản đồ)
const originalShowSidebarWeather = window.showSidebarWeather;
window.showSidebarWeather = async function(name, coords, fullAddress) {
  isAutoOpening = true; // Bật cờ để switchTab không tự động đóng cửa sổ
  
  await originalShowSidebarWeather(name, coords, fullAddress);
  
  if (window.innerWidth <= 900) {
    const sidebar = document.querySelector('.sidebar');
    sidebar.classList.remove('sheet-hidden', 'sheet-expanded');
    sidebar.classList.add('sheet-peek'); // Kéo cửa sổ lên nhô một nửa
  }
  
  // Tắt cờ sau khi hoàn tất
  setTimeout(() => isAutoOpening = false, 100);
};