// FilmDNA · Browser-side algorithm
// Translated from build_radar.py to pure JavaScript

const SUB_DIM_META = {
  color_temp:    { group: "visual",    label: "色温",       low: "冷",         high: "暖" },
  contrast:      { group: "visual",    label: "对比度",     low: "柔和",       high: "强烈" },
  saturation:    { group: "visual",    label: "饱和度",     low: "黑白/低饱",  high: "浓彩/高饱" },
  composition:   { group: "visual",    label: "构图严密度", low: "松散",       high: "对称严谨" },
  shot_length:   { group: "cinematic", label: "镜头长度",   low: "剪切派",     high: "长镜头派" },
  camera_motion: { group: "cinematic", label: "摄影机运动", low: "静止凝视",   high: "躁动手持" },
  distance:      { group: "cinematic", label: "景别偏好",   low: "特写贴脸",   high: "大远景" },
  depth_of_field:{ group: "cinematic", label: "景深运用",   low: "浅景虚化",   high: "深焦清晰" },
  non_linearity: { group: "narrative", label: "非线性度",   low: "线性顺叙",   high: "碎片打乱" },
  pov:           { group: "narrative", label: "视点开放度", low: "单一视点",   high: "多线交织" },
  ending_openness:{group: "narrative", label: "结局开放度", low: "封闭明确",   high: "开放留白" },
  time_density:  { group: "narrative", label: "时间密度",   low: "稀疏快节",   high: "稠密慢吟" },
  auteurism:     { group: "genre",     label: "作者性",     low: "匿名工业",   high: "强烈作者签名" },
  anti_genre:    { group: "genre",     label: "类型反叛",   low: "类型纯血",   high: "反类型/混血" },
  doc_fiction:   { group: "genre",     label: "虚实比",     low: "纯虚构",     high: "纪录倾向" },
  animation_live:{ group: "genre",     label: "动画/真人",  low: "真人",       high: "动画" },
};

let TAGLIB = null;
let GALAXY = null;
let PERSONAS = null;

async function loadFilmDNAData() {
  if (TAGLIB) return;
  const [t, g, p] = await Promise.all([
    fetch("./film_taglib.json").then(r => r.json()),
    fetch("./director_galaxy.json").then(r => r.json()),
    fetch("./personality_types.json").then(r => r.json()),
  ]);
  TAGLIB = t;
  GALAXY = g;
  PERSONAS = p;
}

function normalizeTitle(t) {
  return (t || "").trim().toLowerCase().replaceAll("《", "").replaceAll("》", "").replaceAll(" ", "");
}

function findFilm(title) {
  const n = normalizeTitle(title);
  for (const f of TAGLIB.films) {
    if (normalizeTitle(f.title_zh || "") === n) return f;
    if (normalizeTitle(f.title_en || "") === n) return f;
  }
  for (const f of TAGLIB.films) {
    if (n && (normalizeTitle(f.title_zh || "").includes(n) ||
              normalizeTitle(f.title_en || "").includes(n))) return f;
  }
  return null;
}

function filmTo5D(tags) {
  const visual = tags.color_temp*0.25 + tags.contrast*0.25 + tags.saturation*0.25 + tags.composition*0.25;
  const cinematic = tags.shot_length*0.35 + tags.camera_motion*0.2 + tags.distance*0.2 + tags.depth_of_field*0.25;
  const narrative = (1-tags.linearity)*0.3 + tags.pov*0.2 + tags.ending_openness*0.3 + tags.time_density*0.2;
  const genre = tags.auteurism*0.5 + (1-tags.genre_purity)*0.3 + tags.doc_fiction*0.1 + tags.animation_live*0.1;
  return { visual, cinematic, narrative, genre };
}

function aggregateUserVector(films) {
  const n = films.length;
  if (n === 0) return null;
  const vecs = films.map(f => filmTo5D(f.tags));
  const main = {
    visual:    vecs.reduce((s, v) => s + v.visual, 0) / n,
    cinematic: vecs.reduce((s, v) => s + v.cinematic, 0) / n,
    narrative: vecs.reduce((s, v) => s + v.narrative, 0) / n,
    genre:     vecs.reduce((s, v) => s + v.genre, 0) / n,
  };
  // Geo distribution
  const geoCount = {};
  films.forEach(f => {
    const r = f.tags.region;
    geoCount[r] = (geoCount[r] || 0) + 1;
  });
  const geo = {};
  for (const k in geoCount) geo[k] = geoCount[k] / n;
  // Lineage
  const lineageCount = {};
  films.forEach(f => {
    const l = f.tags.theory_lineage;
    lineageCount[l] = (lineageCount[l] || 0) + 1;
  });
  const lineage = {};
  for (const k in lineageCount) lineage[k] = lineageCount[k] / n;
  // Era
  const eraCount = {};
  films.forEach(f => {
    const e = f.tags.era;
    eraCount[e] = (eraCount[e] || 0) + 1;
  });
  const era = {};
  for (const k in eraCount) era[k] = eraCount[k] / n;

  return { main, geo, lineage, era };
}

function determineQuadrant(lineageDist) {
  if (!lineageDist) return "post_classical";
  const sorted = Object.entries(lineageDist).sort((a, b) => b[1] - a[1]);
  let top = sorted[0][0];
  if (top === "classical_humanism") return "classical_narrative";
  return top;
}

function closestDirectors(userMain, lineageDist, geoDist, filmVectors, inputDirectors) {
  const userVec = [userMain.visual, userMain.cinematic, userMain.narrative, userMain.genre];
  const baseScores = {};

  GALAXY.directors.forEach(d => {
    const dVec = [d.visual, d.cinematic, d.narrative, d.genre];
    const eucl = Math.sqrt(userVec.reduce((s, v, i) => s + (v - dVec[i])**2, 0));
    let baseSim = Math.max(0, 0.30 * (1 - eucl / 1.6));

    let linBonus = 0;
    if (lineageDist) {
      const lin = d.lineage;
      let userLinShare = lineageDist[lin] || 0;
      if (lin === "classical_humanism") {
        userLinShare = Math.max(userLinShare, lineageDist.classical_narrative || 0);
      }
      linBonus = userLinShare * 0.12;
    }
    let geoBonus = 0;
    if (geoDist) {
      geoBonus = (geoDist[d.geo] || 0) * 0.08;
    }

    baseScores[d.name] = {
      name: d.name,
      name_en: d.name_en || "",
      similarity: baseSim + linBonus + geoBonus,
      signature: d.signature || "",
      geo: d.geo || "",
      lineage: d.lineage || "",
      votes: 0,
      directVotes: 0,
    };
  });

  // Direct votes from input directors
  if (inputDirectors) {
    inputDirectors.forEach(dn => {
      if (baseScores[dn]) {
        baseScores[dn].directVotes += 1;
        baseScores[dn].votes += 2.0;
      }
    });
  }

  // Vector neighbor votes
  if (filmVectors) {
    filmVectors.forEach(fv => {
      const fVec = [fv.visual, fv.cinematic, fv.narrative, fv.genre];
      const perFilm = GALAXY.directors.map(d => {
        const dVec = [d.visual, d.cinematic, d.narrative, d.genre];
        const eucl = Math.sqrt(fVec.reduce((s, v, i) => s + (v - dVec[i])**2, 0));
        return [d.name, eucl];
      });
      perFilm.sort((a, b) => a[1] - b[1]);
      const ranksW = [1.0, 0.6, 0.35];
      perFilm.slice(0, 3).forEach(([name, _], rank) => {
        if (baseScores[name]) baseScores[name].votes += ranksW[rank];
      });
    });
  }

  const allScores = Object.values(baseScores);
  const maxVotes = Math.max(...allScores.map(s => s.votes), 0);
  if (maxVotes > 0) {
    allScores.forEach(s => {
      s.similarity = Math.min(1, s.similarity + (s.votes / maxVotes) * 0.50);
    });
  }
  allScores.forEach(s => {
    s.similarity = Math.round(s.similarity * 1000) / 1000;
  });
  allScores.sort((a, b) => {
    if (b.directVotes !== a.directVotes) return b.directVotes - a.directVotes;
    return b.similarity - a.similarity;
  });
  return allScores.slice(0, 3).map(s => {
    const { votes, directVotes, ...rest } = s;
    return rest;
  });
}

function matchPersonality(userMain, quadrant) {
  const visualPole = userMain.visual >= 0.6 ? "lyric" : "austere";
  const narrativePole = userMain.narrative >= 0.6 ? "open" : "closed";
  const qCanon = quadrant === "classical_humanism" ? "classical_narrative" : quadrant;

  for (const p of PERSONAS.types) {
    if (p.quadrant === qCanon &&
        p.poles.visual === visualPole &&
        p.poles.narrative === narrativePole) {
      return p;
    }
  }
  return PERSONAS.types[0];
}

function dnaString(user) {
  const m = user.main;
  const vL = Math.min(5, Math.max(1, Math.floor(m.visual * 5) + 1));
  const nL = Math.min(5, Math.max(1, Math.floor(m.narrative * 5) + 1));
  const gL = Math.min(5, Math.max(1, Math.floor(m.genre * 5) + 1));
  let topGeo = "mixed";
  if (Object.keys(user.geo).length > 0) {
    topGeo = Object.entries(user.geo).sort((a, b) => b[1] - a[1])[0][0];
  }
  const geoCode = {
    east_asia: "EA", europe: "EU", north_america: "NA",
    latin_america: "LA", middle_east: "ME", south_asia: "SA", mixed: "MX",
  }[topGeo] || "MX";
  return `V${vL}-N${nL}-G${gL}-${geoCode}`;
}

function recommend(userMain, usedIds, usedDirectors, k = 10) {
  const userVec = [userMain.visual, userMain.cinematic, userMain.narrative, userMain.genre];
  const candidates = [];
  TAGLIB.films.forEach(f => {
    if (usedIds.has(f.id)) return;
    const v = filmTo5D(f.tags);
    const fVec = [v.visual, v.cinematic, v.narrative, v.genre];
    let eucl = Math.sqrt(fVec.reduce((s, x, i) => s + (x - userVec[i])**2, 0));
    if (usedDirectors.has(f.director)) eucl += 0.15;
    candidates.push([f, eucl]);
  });
  candidates.sort((a, b) => a[1] - b[1]);
  const chosen = [];
  const dirCount = {};
  for (const [f, dist] of candidates) {
    const d = f.director || "";
    if ((dirCount[d] || 0) >= 1) continue;
    chosen.push({
      title_zh: f.title_zh || "",
      title_en: f.title_en || "",
      director: d,
      year: f.year || "",
      distance: Math.round(dist * 1000) / 1000,
      reason: makeReason(f, dist, userMain),
    });
    dirCount[d] = (dirCount[d] || 0) + 1;
    if (chosen.length >= k) break;
  }
  return chosen;
}

function makeReason(film, dist, userMain) {
  const tags = film.tags;
  const parts = [];
  if (tags.shot_length > 0.85 && userMain.cinematic > 0.7) parts.push("长镜头气质契合");
  if (tags.composition > 0.85 && userMain.visual > 0.7) parts.push("构图完成度高");
  if (tags.ending_openness > 0.8 && userMain.narrative > 0.6) parts.push("结局开放留白");
  if (tags.auteurism > 0.9) parts.push("作者印记强");
  if (tags.saturation > 0.85 && userMain.visual > 0.7) parts.push("饱和色彩");
  if (parts.length === 0) parts.push(`${film.director || ""}的代表作之一`);
  return parts.slice(0, 3).join("·");
}

function computeSubDimensions(films) {
  if (films.length === 0) return {};
  const n = films.length;
  const rawKeys = ["color_temp","contrast","saturation","composition",
    "shot_length","camera_motion","distance","depth_of_field",
    "pov","ending_openness","time_density",
    "auteurism","doc_fiction","animation_live"];
  const avgs = {};
  rawKeys.forEach(k => {
    avgs[k] = films.reduce((s, f) => s + (f.tags[k] || 0), 0) / n;
  });
  avgs.non_linearity = 1 - films.reduce((s, f) => s + (f.tags.linearity || 0), 0) / n;
  avgs.anti_genre   = 1 - films.reduce((s, f) => s + (f.tags.genre_purity || 0), 0) / n;

  const out = {};
  for (const [key, meta] of Object.entries(SUB_DIM_META)) {
    out[key] = {
      value: Math.round(avgs[key] * 1000) / 1000,
      percent: Math.round(avgs[key] * 100),
      ...meta,
    };
  }
  return out;
}

function computeDiagnosticTags(subDims) {
  if (Object.keys(subDims).length === 0) return [];
  const v = (k) => subDims[k]?.value ?? 0.5;

  const sl = v("shot_length");
  const rhythm = sl >= 0.75 ? "慢呼吸" : sl >= 0.55 ? "稳吟咏" : sl >= 0.4 ? "中速行" : "快剪派";

  const ct = v("color_temp"), sat = v("saturation");
  let color;
  if (sat < 0.25) color = "黑白/低饱";
  else if (ct >= 0.65 && sat >= 0.7) color = "暖肌·高糖";
  else if (ct >= 0.65) color = "暖调中饱";
  else if (ct < 0.4 && sat >= 0.7) color = "霓虹冷艳";
  else if (ct < 0.4) color = "冷调·低饱";
  else color = "中性·均衡";

  const eo = v("ending_openness");
  const ending = eo >= 0.85 ? "永远开放" : eo >= 0.65 ? "留半个谜" : eo >= 0.4 ? "微妙收束" : "明确给答";

  const dist = v("distance");
  const shot = dist >= 0.7 ? "大远景派" : dist >= 0.5 ? "中景写实" : dist >= 0.35 ? "近景紧凑" : "特写贴脸";

  const cm = v("camera_motion");
  const motion = cm >= 0.85 ? "躁动手持" : cm >= 0.6 ? "灵动推移" : cm >= 0.35 ? "克制平稳" : "静默凝视";

  const au = v("auteurism");
  const auth = au >= 0.9 ? "强烈签名" : au >= 0.75 ? "作者印记" : au >= 0.55 ? "半作者半工业" : "类型纯血";

  return [
    { label: "节奏",   value: rhythm },
    { label: "色温",   value: color },
    { label: "结局",   value: ending },
    { label: "景别",   value: shot },
    { label: "运动",   value: motion },
    { label: "作者性", value: auth },
  ];
}

function analyze(filmTitles) {
  const matched = [];
  const unmatched = [];
  filmTitles.forEach(t => {
    const f = findFilm(t);
    if (f) matched.push(f);
    else unmatched.push(t);
  });
  if (matched.length === 0) {
    return { error: "未匹配到任何电影", input: filmTitles, unmatched };
  }
  const user = aggregateUserVector(matched);
  const quadrant = determineQuadrant(user.lineage);
  const filmVecs = matched.map(f => filmTo5D(f.tags));
  const inputDirs = matched.map(f => f.director || "");
  const near = closestDirectors(user.main, user.lineage, user.geo, filmVecs, inputDirs);
  const persona = matchPersonality(user.main, quadrant);
  const usedIds = new Set(matched.map(f => f.id));
  const usedDirs = new Set(matched.map(f => f.director || ""));
  const recs = recommend(user.main, usedIds, usedDirs, 10);
  const dna = dnaString(user);
  const subDims = computeSubDimensions(matched);
  const tags = computeDiagnosticTags(subDims);

  return {
    dna_string: dna,
    input_films: matched.map(f => ({ title_zh: f.title_zh, director: f.director })),
    unmatched,
    radar: {
      visual:    Math.round(user.main.visual * 1000) / 1000,
      cinematic: Math.round(user.main.cinematic * 1000) / 1000,
      narrative: Math.round(user.main.narrative * 1000) / 1000,
      genre:     Math.round(user.main.genre * 1000) / 1000,
    },
    sub_dimensions: subDims,
    diagnostic_tags: tags,
    geo_distribution: user.geo,
    lineage_distribution: user.lineage,
    era_distribution: user.era,
    quadrant,
    closest_directors: near,
    personality: {
      type: persona.type,
      tagline: persona.tagline,
      description: persona.description,
      anchor_directors: persona.anchor_directors || [],
      color_palette: persona.color_palette || [],
    },
    recommendations: recs,
  };
}
