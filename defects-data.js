// CSIRO Aluminium HPDC Defect Analysis — data + live detection engine
// Severity: 'red' = most likely cause(s), 'orange' = possible cause(s)

export const CAUSES = [
  "Metal pressure too low","Metal pressure too high","First stage velocity too low","First stage velocity too high",
  "Change over point too early","Change over point too late","Wrong deceleration setting","Second stage velocity too low",
  "Second stage velocity too high","Intensification too early","Intensification too late","Intensification too high",
  "Intensification too low","Wrong shot weight setting on ladle","Blocked pour hole","Blocked launder on dose furnace",
  "Tube constricted on dose furnace","Solidification time too long/short","Worn locking mechanism / guide pins","Ejection force too high",
  "Ejection delay too high","Ejection delay too short","Locking force too low / machine too small","Irregular operating cycle",
  "Water in cavity / leaking water channel","Leaking oil heating / cooling unit","Too much plunger lube","Not enough plunger lube",
  "Die is too cold","Die is too hot","Sticking plunger","Too much die spray","Not enough die spray","Wrong die spray type",
  "Die lube concentration too low","Dirty die faces / metal adhesion","Leaking vacuum","Vacuum on too soon / late",
  "Ineffective venting and/or overflows","Poor die / shot sleeve surface finish","Inadequate draft or undercut","Poor gating & runner design",
  "Poor thermal control / hot & cold spots","Difficult casting geometry","Metal is too hot / cold","Metal is contaminated and/or dirty",
  "Metal is out of specification"
];

// 24 defect types. causes = 1-based indices into CAUSES (from poster relationships)
export const DEFECTS = [
  {slug:'short-fill', name:'Short Fill', def:'Metal is frozen before the cavity is filled, or insufficient metal was ladled.', causes:[1,3,8,14,18,29,39,42,45]},
  {slug:'cold-shut', name:'Cold Shut', def:'Metal is frozen when two metal fronts join.', causes:[8,6,18,29,42,43,45]},
  {slug:'scaling', name:'Scaling', def:'Layers of metal and oxides created by poor shot-end control and/or bad gate and runner design.', causes:[3,4,5,6,42]},
  {slug:'blister', name:'Blister', def:'Trapped gases expand when the die opens while the casting is still weak, raising a blister.', causes:[12,13,21,27,30,39]},
  {slug:'flash', name:'Flash', def:'Metal pressure on the projected area exceeds clamp force; the die opens at the parting line and metal escapes.', causes:[2,12,19,23,44]},
  {slug:'cold-flakes', name:'Cold Flakes', def:'Metal cools too much in the shot sleeve; solid particles are injected into the cavity.', causes:[3,5,27,28,18,29,45]},
  {slug:'shot-lube-stain', name:'Shot Lube Stain', def:'Too much shot (tip) lube is used.', causes:[27]},
  {slug:'air-porosity', name:'Air Porosity', def:'Trapped air from poor shot-end control, poor venting/overflow, or bad gating & runner design.', causes:[3,4,5,6,9,37,38,39,42]},
  {slug:'drag-marks', name:'Drag Marks', def:'Insufficient draft or an undercut damages the surface on ejection; poor die surface finish contributes.', causes:[20,41,40,29,30]},
  {slug:'hot-tearing', name:'Hot Tearing / Cracking', def:'Metal shrinks under tension during solidification; a tear/crack forms at the last place to solidify.', causes:[18,21,22,43,44,47]},
  {slug:'hot-shortness', name:'Hot Shortness', def:'Alloy composition is too weak at high temperature; cracks form in high-stress regions while cooling.', causes:[47,45,43]},
  {slug:'sink', name:'Sink', def:'A shrinkage cavity near the surface collapses the surface; needs hot spots / very poor thermal control.', causes:[13,1,43,42,18]},
  {slug:'exploded-metal', name:'Exploded Metal', def:'Porosity plus ejection before full solidification; trapped gas bursts out with unsolidified metal.', causes:[21,22,13,30,43]},
  {slug:'warpage', name:'Warpage', def:'The casting deforms while cooling; uneven die temperature is a major cause, plus geometry/alloy.', causes:[21,43,44,47]},
  {slug:'soldering', name:'Soldering', def:'Chemical attack & bonding of aluminium to die steel tears metal away during ejection.', causes:[9,30,45,33,35,47]},
  {slug:'shrinkage-porosity', name:'Shrinkage Porosity', def:'Metal shrinks during solidification and cannot be fed; hot spots concentrate the porosity.', causes:[1,13,11,43,42,18]},
  {slug:'heat-checking', name:'Heat Checking', def:'The tool-steel surface expands/contracts during use; cold dies and die flexing accelerate it.', causes:[29,25,26,30]},
  {slug:'leaker', name:'Leaker', def:'A leak path from oxide folds, inclusions or porosity combined with a surface defect.', causes:[8,39,16,46]},
  {slug:'discoloured-surface', name:'Discoloured Surface', def:'Oxide films/residues/particles or excess die lube; or part of the die too cold (smears).', causes:[32,29,46,36]},
  {slug:'break-out', name:'Break Out', def:'Cold flakes caught in the gate during fill break out unevenly when the casting is trimmed.', causes:[3,5,18,45]},
  {slug:'inclusions', name:'Inclusions', def:'Dirty/contaminated metal and/or poor melt-handling practice.', causes:[46,47]},
  {slug:'ejector-damage', name:'Ejector Damage', def:'Excessive pressure on the casting surface by the ejector pin(s) during ejection.', causes:[20,22,41,30]},
  {slug:'erosion-cavitation', name:'Erosion / Cavitation', def:'Direct molten-metal impingement on die steel; cavitation from turbulence and low-pressure regions.', causes:[9,42,40]},
  {slug:'cracked-casting', name:'Cracked Casting', def:'Mechanical damage when the die opens or the casting is ejected (excludes hot cracking & shrinkage cracking).', causes:[20,22,19,44]}
];

// Live detection. Each rule reads computed values `v` and returns a triggered condition or null.
// d(slug, severity, why) helper builds a defect link.
//
// ===== Process windows (general HPDC guidance) =====
// Each parameter carries a recommended [min,max] for powertrain and for structural parts,
// plus the defects that become likely when it goes below (low) or above (high) the window.
// Values are general industry guidance and are EDITABLE per part class in the app.
// defects entries: [slug, severity('red'|'orange'), why]
export const RANGES = [
  { key:'fillRate', label:'Fill rate (sleeve fraction)', unit:'%', dec:1, powertrain:[30,50], structural:[40,60],
    low:{ note:'First-stage fill fraction too low — large air volume in the sleeve.',
      defects:[['air-porosity','red','A low fill fraction leaves a large air pocket the slow-shot wave folds in.'],['blister','orange','Entrained sleeve air later expands when the die opens.'],['scaling','orange','A breaking wave layers oxide into the metal front.']] },
    high:{ note:'Sleeve over-full — metal splashes ahead of the plunger.',
      defects:[['air-porosity','orange','An over-full sleeve splashes ahead of the plunger, folding in air.'],['cold-flakes','orange','Splashed metal freezes on cold sleeve walls and is carried in.']] } },

  { key:'gateSpeed', label:'Gate (2nd-stage) velocity', unit:'m/s', dec:1, powertrain:[25,45], structural:[30,60],
    low:{ note:'In-gate velocity too low (cause 8) — fronts cool before joining.',
      defects:[['cold-shut','red','The metal front freezes before the two fronts can weld together.'],['short-fill','red','Metal freezes before the cavity is completely filled.'],['cold-flakes','orange','Slow filling lets solid particles form and enter the cavity.'],['scaling','orange','Poor front coherence layers oxide and metal.']] },
    high:{ note:'In-gate velocity too high (cause 9) — turbulent, erosive flow.',
      defects:[['erosion-cavitation','red','High-velocity impingement and cavitation erode the die steel.'],['soldering','orange','High velocity plus heat promote aluminium bonding to the die.'],['air-porosity','orange','Turbulent flow at high velocity entrains air.'],['flash','orange','Velocity spikes raise impact pressure on the parting line.']] } },

  { key:'slowRatio', label:'Slow-shot vs critical velocity', unit:'%', dec:0, powertrain:[80,90], structural:[80,90],
    low:{ note:'First-stage velocity below critical (cause 3) — wave breaks in the sleeve.',
      defects:[['air-porosity','red','Below critical velocity the wave breaks and entrains air in the sleeve.'],['blister','orange','Entrained sleeve air later expands at ejection.']] },
    high:{ note:'First-stage velocity above critical (cause 4) — wave breaks from over-speed.',
      defects:[['air-porosity','orange','Accelerating past critical too hard makes the wave break and trap air.']] } },

  { key:'pistonVel', label:'2nd-stage piston velocity', unit:'m/s', dec:2, powertrain:[2,5], structural:[3,6],
    low:{ note:'Plunger 2nd-stage velocity low — slow cavity fill.',
      defects:[['cold-shut','orange','Slow plunger advance lets fronts cool before joining.'],['short-fill','orange','Slow fill risks freezing before the cavity is complete.']] },
    high:{ note:'Plunger 2nd-stage velocity high — aggressive, turbulent fill.',
      defects:[['erosion-cavitation','orange','Fast plunger advance raises gate velocity and erosion.'],['flash','orange','A fast plunger raises the dynamic pressure peak on the parting line.']] } },

  { key:'fillRatio', label:'Fill time vs thermal recommendation', unit:'%', dec:0, powertrain:[80,120], structural:[80,120],
    low:{ note:'Filling much faster than the thermal optimum.',
      defects:[['erosion-cavitation','orange','Very fast filling raises velocity and turbulence at the gate.'],['air-porosity','orange','Turbulent fast fill folds in air.']] },
    high:{ note:'Filling slower than the thermal limit (cause 18).',
      defects:[['cold-shut','red','Filling slower than the thermal limit lets fronts freeze before joining.'],['short-fill','orange','Metal may freeze before the cavity is full.'],['scaling','orange','Slow, cooling flow layers oxides.']] } },

  { key:'biscuit', label:'Biscuit thickness', unit:'mm', dec:0, powertrain:[25,45], structural:[20,40],
    low:{ note:'Biscuit too thin — poor intensification feed, risk of plunger reaching end of stroke.',
      defects:[['shrinkage-porosity','red','A thin biscuit cannot transmit intensification pressure to feed shrinkage.'],['sink','orange','Without feed pressure, near-surface shrinkage collapses the surface.']] },
    high:{ note:'Biscuit too thick — wasted shot energy, longer cycle, softer pressure transfer.',
      defects:[['shrinkage-porosity','orange','A thick biscuit transmits intensification pressure poorly, hindering feeding.']] } },

  { key:'specPressure', label:'Specific (intensification) pressure', unit:'bar', dec:0, powertrain:[300,1000], structural:[250,800],
    low:{ note:'Specific pressure too low (cause 1) — insufficient feeding & compaction.',
      defects:[['shrinkage-porosity','red','Low final pressure cannot feed solidification shrinkage.'],['sink','orange','Poor compaction lets the surface sink over shrinkage cavities.'],['leaker','orange','Residual porosity creates leak paths in pressure-tight parts.']] },
    high:{ note:'Specific pressure too high (cause 2) — parting-line load may exceed clamp.',
      defects:[['flash','red','High pressure on the projected area forces the die open at the parting line.']] } }
];

export function activeRange(key, partClass, overrides){
  const base = RANGES.find(r=>r.key===key);
  if(!base) return [null,null];
  const o = overrides && overrides[partClass] && overrides[partClass][key];
  return o || base[partClass];
}

// Analyze live values against the active part-class windows.
// v: map of {key: number|null}. Returns {rows, risks}.
export function analyze(v, partClass, overrides){
  const find = s => DEFECTS.find(x=>x.slug===s);
  const rows = [];
  const risks = [];
  for(const r of RANGES){
    const [min,max] = activeRange(r.key, partClass, overrides);
    const val = v[r.key];
    let status = 'na';
    if(val!=null && isFinite(val)){
      if(min!=null && val < min) status='low';
      else if(max!=null && val > max) status='high';
      else status='in';
    }
    rows.push({ key:r.key, label:r.label, unit:r.unit, dec:r.dec, min, max, value:val, status });
    if((status==='low' || status==='high') && r[status]){
      const spec = r[status];
      risks.push({
        id:r.key+'-'+status, key:r.key, label:r.label, unit:r.unit, dec:r.dec,
        value:val, min, max, direction:status, note:spec.note,
        defects: spec.defects.map(([slug,severity,why])=>({ ...find(slug), severity, why }))
      });
    }
  }
  return { rows, risks };
}

// Risks derived from the Factor Relation sheet:
//  - shot ÷ casting weight relation above the ≤2.0 guideline
//  - runner section taper factors that diverge (>1) or taper too sharply (<0.5)
export function factorRisks(relation, factors){
  const find = s => DEFECTS.find(x=>x.slug===s);
  const D=(slug,severity,why)=>({...find(slug),severity,why});
  const out=[];
  if(relation!=null && isFinite(relation) && relation > 2.0){
    const sev = relation>2.5?'red':'orange';
    out.push({ id:'relation-high', key:'relation', label:'Shot ÷ casting weight relation', unit:': 1', dec:2,
      value:relation, min:null, max:2.0, direction:'high',
      note:'Runner + overflow volume is large relative to the casting (guideline ≤ 2.0) — extra heat load and feed competition.',
      defects:[ D('shrinkage-porosity',sev,'The large runner/biscuit mass competes for feed metal and concentrates shrinkage in the part.'),
                D('soldering','orange','The extra metal mass raises die temperature, promoting soldering.'),
                D('scaling','orange','Oversized runners slow and cool the metal front, layering oxide.') ] });
  }
  (factors||[]).forEach((f,idx)=>{
    if(f.factor==null || !isFinite(f.factor)) return;
    if(f.factor > 1.0){
      out.push({ id:'factor-div-'+idx, key:'factor', label:'Runner taper — '+f.label, unit:'×', dec:3,
        value:f.factor, min:null, max:1.0, direction:'high',
        note:'Section widens toward the gate (factor > 1) — the metal decelerates and the flow can separate.',
        defects:[ D('air-porosity','red','A diverging section drops velocity and creates low-pressure zones that entrain air.'),
                  D('cold-shut','orange','Decelerating, cooling metal may freeze before the fronts join.'),
                  D('erosion-cavitation','orange','Low-pressure separation zones cavitate against the die steel.') ] });
    } else if(f.factor < 0.5){
      out.push({ id:'factor-sharp-'+idx, key:'factor', label:'Runner taper — '+f.label, unit:'×', dec:3,
        value:f.factor, min:0.5, max:null, direction:'low',
        note:'Very sharp area reduction (factor < 0.5) — abrupt acceleration and jetting.',
        defects:[ D('erosion-cavitation','orange','Abrupt constriction jets metal and erodes the die.'),
                  D('air-porosity','orange','Jetting through a sharp restriction folds in air.'),
                  D('scaling','orange','Turbulent jetting layers oxide into the metal front.') ] });
    }
  });
  return out;
}

// ============================================================================
// Casting defects & process parameters — influence overview
// Source: "Gussfehler und Prozessparameter – Übersicht" (cold-chamber HPDC).
// The authoritative scan is shown in the app; these tables provide an English
// key + grid geometry so each row/column can be highlighted on the real chart,
// and link the chart's process parameters to the parameters in this app.
// ============================================================================

// 26 influence factors (columns), left→right, with group + the matching app parameter key (if any).
export const INF_FACTORS = [
  { i:1,  group:'Die-casting machine', en:'Plunger velocity — 1st phase (slow shot)', de:'Gießkolbengeschw. 1. Phase', appKey:'slowRatio' },
  { i:2,  group:'Die-casting machine', en:'Plunger velocity — 2nd phase (fast shot)', de:'Gießkolbengeschw. 2. Phase', appKey:'pistonVel' },
  { i:3,  group:'Die-casting machine', en:'Switch-over point 1st/2nd phase', de:'Umschaltpunkt 1./2. Phase', appKey:'fillRate' },
  { i:4,  group:'Die-casting machine', en:'Intensification pressure level', de:'Nachdruckhöhe', appKey:'specPressure' },
  { i:5,  group:'Die-casting machine', en:'Intensification delay / build-up time', de:'Nachdruckverzögerung / Nachdruckaufbauzeit', appKey:null },
  { i:6,  group:'Die-casting machine', en:'Clamp force / cycle time', de:'Zuhaltekraft / Zykluszeit', appKey:'clamp' },
  { i:7,  group:'Shot end (sleeve & plunger)', en:'Plunger diameter', de:'Gießkolbendurchmesser', appKey:'biscuit' },
  { i:8,  group:'Shot end (sleeve & plunger)', en:'Shot-sleeve fill ratio', de:'Gießkammerfüllgrad', appKey:'fillRate' },
  { i:9,  group:'Shot end (sleeve & plunger)', en:'Shot-sleeve temperature', de:'Gießkammertemperatur', appKey:null },
  { i:10, group:'Shot end (sleeve & plunger)', en:'Plunger lubricant', de:'Gießkolbenschmierstoff', appKey:null },
  { i:11, group:'Melt', en:'Melt temperature', de:'Schmelzetemperatur', appKey:null },
  { i:12, group:'Melt', en:'Impurities / shielding gas', de:'Verunreinigungen / Schutzgas', appKey:null },
  { i:13, group:'Melt', en:'Alloy composition', de:'Legierung / Zusammensetzung', appKey:'alloy' },
  { i:14, group:'Die', en:'Melt velocity at the gate', de:'Schmelzegeschwindigkeit im Anschnitt', appKey:'gateSpeed' },
  { i:15, group:'Die', en:'Cavity fill time', de:'Formfüllzeit', appKey:'fillRatio' },
  { i:16, group:'Die', en:'Gate location', de:'Lage des Anschnittes', appKey:null },
  { i:17, group:'Die', en:'Gate geometry & type', de:'Anschnittgeometrie und -art', appKey:'gateSpeed' },
  { i:18, group:'Die', en:'Gate thickness', de:'Anschnittdicke', appKey:'gateSpeed' },
  { i:19, group:'Die', en:'Die temperature', de:'Formtemperatur', appKey:null },
  { i:20, group:'Die', en:'Temperature-control system / layout', de:'Temperiersysteme / Ausbildung', appKey:null },
  { i:21, group:'Die', en:'Coolant medium / flow', de:'Temperiermedium / -menge', appKey:null },
  { i:22, group:'Die', en:'Release-agent amount', de:'Trennmittelmenge', appKey:null },
  { i:23, group:'Die', en:'Release-agent concentration & type', de:'Trennmittelkonzentration und -art', appKey:null },
  { i:24, group:'Die', en:'Die venting', de:'Formentlüftung', appKey:null },
  { i:25, group:'Die', en:'Die surface condition', de:'Zustand der Formoberfläche', appKey:null },
  { i:26, group:'Die', en:'Die parallelism & offset', de:'Parallelität und Versatz Gießform', appKey:null }
];

// 17 defects (rows), top→bottom, with group + linked DEFECTS slug (where one exists in the library).
export const INF_DEFECTS = [
  { i:1,  group:'Shape / dimensional', en:'Casting dimensions', de:'Gußteilmaße', slug:null },
  { i:2,  group:'Shape / dimensional', en:'Deformation / warpage', de:'Deformation / Verzug', slug:'warpage' },
  { i:3,  group:'Shape / dimensional', en:'Incompleteness (misrun)', de:'Unvollständigkeit', slug:'short-fill' },
  { i:4,  group:'Shape / dimensional', en:'Flash', de:'Grat', slug:'flash' },
  { i:5,  group:'Surface', en:'Cracks', de:'Risse', slug:'cracked-casting' },
  { i:6,  group:'Surface', en:'Cold flow / swirls', de:'Kaltfluß / Wirbel', slug:'cold-shut' },
  { i:7,  group:'Surface', en:'Sticking / roughness', de:'Klebstellen / Rauheiten', slug:'soldering' },
  { i:8,  group:'Surface', en:'Drag marks', de:'Ziehriefen', slug:'drag-marks' },
  { i:9,  group:'Surface', en:'Blisters', de:'Blasen', slug:'blister' },
  { i:10, group:'Surface', en:'Sink marks', de:'Einfallstellen', slug:'sink' },
  { i:11, group:'Surface', en:'Flow lines', de:'Fließlinien', slug:null },
  { i:12, group:'Surface', en:'Discoloration', de:'Verfärbungen', slug:'discoloured-surface' },
  { i:13, group:'Internal', en:'Gas porosity', de:'Gasporosität', slug:'air-porosity' },
  { i:14, group:'Internal', en:'Shrinkage cavity', de:'Lunker', slug:'shrinkage-porosity' },
  { i:15, group:'Internal', en:'Microcracks', de:'Mikrorisse', slug:'hot-tearing' },
  { i:16, group:'Internal', en:'Layer porosity', de:'Schichtporosität', slug:'scaling' },
  { i:17, group:'Internal', en:'Inclusions', de:'Einschlüsse', slug:'inclusions' }
];

// Legend for influence strength.
export const INF_LEGEND = [
  { lvl:0, label:'no influence' },
  { lvl:1, label:'minor' },
  { lvl:2, label:'normal' },
  { lvl:3, label:'strong' }
];

// Native influence relations: for each factor (column index 1..26), the defects it drives
// and the strength (1 minor · 2 normal · 3 strong). Grounded in HPDC cause-and-effect
// (the same engineering as the process chart) and in this app's own range model.
// Each entry: [defectSlug, strength, short why].
export const INF_REL = {
  1:[['air-porosity',3,'Below critical 1st-stage velocity the sleeve wave breaks and folds in air.'],['cold-flakes',2,'Too-slow 1st stage lets metal freeze on the sleeve wall.'],['blister',2,'Entrained sleeve air later expands at ejection.'],['scaling',2,'A breaking wave layers oxide into the front.'],['short-fill',1,'A weak 1st stage can stall the fill.']],
  2:[['erosion-cavitation',3,'High 2nd-stage velocity impinges and cavitates against the die.'],['air-porosity',3,'Excess velocity makes the front atomise and trap air.'],['cold-shut',2,'Too-low 2nd stage lets fronts freeze before joining.'],['short-fill',2,'Slow fast-shot risks freezing before the cavity is full.'],['flash',1,'A fast plunger raises the dynamic pressure peak.']],
  3:[['air-porosity',3,'A late switch-over leaves the sleeve wave to entrain air; too early wastes stroke.'],['cold-flakes',2,'A late change-over cools metal in the sleeve.'],['short-fill',2,'An early switch-over can starve the end of fill.'],['scaling',1,'Poor shot-end timing layers oxide.']],
  4:[['shrinkage-porosity',3,'Low intensification pressure cannot feed solidification shrinkage.'],['sink',2,'Poor compaction lets the surface sink over cavities.'],['leaker',2,'Unfed porosity creates leak paths.'],['flash',2,'Excess intensification can open the parting line.'],['blister',1,'Pressure timing affects sub-surface gas.']],
  5:[['shrinkage-porosity',3,'Late/long intensification build-up misses the feeding window.'],['blister',2,'Mis-timed pressure traps expanding gas.'],['sink',1,'Delayed pressure under-feeds the surface.']],
  6:[['flash',3,'Clamp force below the metal-pressure load opens the die at the parting line.'],['warpage',1,'Irregular cycle time upsets thermal balance.']],
  7:[['shrinkage-porosity',2,'Plunger diameter sets pressure & biscuit feed; a poor match starves feeding.'],['air-porosity',2,'Diameter sets the sleeve fill ratio and air volume.'],['flash',1,'Larger bore raises the projected metal force.']],
  8:[['air-porosity',3,'A low sleeve fill ratio leaves a large air pocket the wave folds in.'],['cold-flakes',2,'An over-full sleeve splashes and freezes metal on the walls.'],['blister',2,'Entrained sleeve air expands at ejection.'],['scaling',1,'A breaking wave layers oxide.']],
  9:[['cold-flakes',3,'A cold shot sleeve freezes solid flakes that inject into the cavity.'],['cold-shut',2,'Cooler metal freezes before fronts join.'],['soldering',2,'An over-hot sleeve promotes aluminium bonding.'],['short-fill',1,'Heat loss in the sleeve shortens the fill.']],
  10:[['shot-lube-stain',3,'Too much plunger lube stains the casting.'],['air-porosity',2,'Excess lube gasifies and entrains in the metal.'],['inclusions',2,'Burnt lube residue is carried into the shot.'],['blister',1,'Lube gas expands sub-surface.']],
  11:[['cold-shut',3,'Low melt temperature freezes fronts before they weld.'],['short-fill',3,'Cold metal freezes before the cavity is full.'],['soldering',3,'Over-hot metal chemically attacks and bonds to the die.'],['shrinkage-porosity',2,'Hotter metal shrinks more on solidification.'],['hot-tearing',2,'Excess superheat widens the tearing range.'],['scaling',1,'Temperature swings change oxide layering.']],
  12:[['inclusions',3,'Impurities and oxides become entrapped inclusions.'],['air-porosity',2,'Lost shielding lets the melt oxidise and entrain gas.'],['leaker',2,'Oxide films create connected leak paths.'],['discoloured-surface',1,'Surface oxide films discolour the part.']],
  13:[['hot-shortness',3,'A weak alloy composition cracks at high temperature.'],['hot-tearing',2,'Composition sets the solidification/tearing range.'],['shrinkage-porosity',2,'Alloy freezing range governs feedability.'],['cold-shut',1,'Fluidity depends on composition.'],['inclusions',1,'Off-spec chemistry carries hard particles.']],
  14:[['cold-shut',3,'Low in-gate velocity lets fronts cool before joining.'],['short-fill',3,'Too-low gate velocity freezes before fill is complete.'],['erosion-cavitation',3,'Excess gate velocity erodes and cavitates the die.'],['soldering',2,'High velocity plus heat bonds metal to the steel.'],['air-porosity',2,'Turbulent high-velocity flow folds in air.'],['cold-flakes',1,'Slow gate flow carries frozen flakes.']],
  15:[['cold-shut',3,'Filling slower than the thermal limit freezes fronts before joining.'],['short-fill',2,'A long fill time can freeze before completion.'],['erosion-cavitation',2,'Very fast fill raises velocity and turbulence.'],['air-porosity',2,'Turbulent fast fill folds in air.'],['scaling',1,'Cooling fronts layer oxide.']],
  16:[['cold-shut',2,'Poor gate location makes fronts meet far from the gate and freeze.'],['air-porosity',3,'Bad gating drives the front to trap air against walls.'],['erosion-cavitation',2,'A mis-placed gate jets onto a core or wall.'],['short-fill',2,'Distant fill paths freeze before completion.'],['shrinkage-porosity',1,'Gate position governs feed access.']],
  17:[['air-porosity',3,'Poor gate geometry/type makes the jet break up and entrain air.'],['erosion-cavitation',3,'A sharp or mis-shaped gate jets and erodes the die.'],['cold-shut',2,'Bad gating splits and cools the front.'],['scaling',2,'Turbulent gate flow layers oxide.'],['short-fill',1,'A choked gate starves the fill.']],
  18:[['air-porosity',2,'A thin gate jets metal and folds in air.'],['erosion-cavitation',2,'A thin gate raises local velocity and erosion.'],['cold-shut',2,'A thin gate freezes the front early.'],['short-fill',2,'Too-thin a gate chokes the fill.'],['shrinkage-porosity',1,'Gate thickness limits intensification feed.']],
  19:[['soldering',3,'A hot die chemically attacks and bonds aluminium.'],['shrinkage-porosity',3,'Hot spots concentrate solidification shrinkage.'],['cold-shut',2,'A cold die freezes fronts before joining.'],['sink',2,'Hot spots collapse the surface over shrinkage.'],['heat-checking',2,'Thermal cycling cracks the die surface.'],['drag-marks',1,'A cold die smears the surface on ejection.']],
  20:[['shrinkage-porosity',3,'Poor cooling layout leaves hot spots that concentrate shrinkage.'],['warpage',3,'Uneven die temperature warps the casting.'],['soldering',2,'Hot zones promote aluminium bonding.'],['sink',2,'Local hot spots sink the surface.'],['heat-checking',1,'Thermal gradients fatigue the steel.']],
  21:[['warpage',2,'Coolant flow imbalance distorts the casting on cooling.'],['shrinkage-porosity',2,'Insufficient cooling leaves feeding hot spots.'],['soldering',1,'Under-cooling overheats local die zones.']],
  22:[['blister',2,'Excess release agent gasifies and raises sub-surface blisters.'],['discoloured-surface',3,'Too much spray stains and discolours the surface.'],['air-porosity',2,'Spray gas is entrained in the metal.']],
  23:[['soldering',2,'Wrong release-agent type fails to part the metal cleanly.'],['discoloured-surface',3,'Wrong concentration/type stains the surface.'],['drag-marks',1,'Poor parting drags the surface on ejection.']],
  24:[['air-porosity',3,'Ineffective venting traps cavity air in the metal.'],['blister',2,'Trapped vent air expands at ejection.'],['short-fill',2,'Back-pressure from poor venting starves the fill.'],['cold-shut',1,'Trapped gas blocks the joining of fronts.']],
  25:[['drag-marks',3,'A poor die surface finish scores the casting on ejection.'],['soldering',2,'A rough/eroded surface keys aluminium to the steel.'],['discoloured-surface',2,'Adhesion and residue discolour the part.'],['leaker',1,'Surface defects open leak paths.']],
  26:[['flash',3,'Parting-line non-parallelism/offset opens a gap that flashes.'],['heat-checking',2,'Die flexing concentrates surface stress.'],['cracked-casting',1,'Misalignment damages the part on ejection.']]
};

// Build the per-factor influence list (resolving defect names) and the reverse per-defect list.
export function influenceByFactor(){
  const dmap = {}; DEFECTS.forEach(d=>dmap[d.slug]=d);
  return INF_FACTORS.map(f=>({
    ...f,
    defects: (INF_REL[f.i]||[]).map(([slug,s,why])=>({ slug, s, why, name: (dmap[slug]?dmap[slug].name : slug) }))
                                .sort((a,b)=>b.s-a.s)
  }));
}
export function influenceByDefect(){
  const out = {};
  INF_DEFECTS.forEach(d=>{ if(d.slug) out[d.slug] = { ...d, factors:[] }; });
  // also cover library defects that the chart maps to (use DEFECTS list for naming)
  DEFECTS.forEach(d=>{ if(!out[d.slug]) out[d.slug] = { en:d.name, slug:d.slug, group:'', factors:[] }; });
  Object.entries(INF_REL).forEach(([fi,arr])=>{
    const f = INF_FACTORS[(+fi)-1];
    arr.forEach(([slug,s,why])=>{ if(out[slug]) out[slug].factors.push({ i:f.i, en:f.en, group:f.group, appKey:f.appKey, s, why }); });
  });
  Object.values(out).forEach(o=>o.factors.sort((a,b)=>b.s-a.s));
  return out;
}

