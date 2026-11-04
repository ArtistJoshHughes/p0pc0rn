// survival_ui.js - the open world's screens (v5): the HUD's clock, leech and bin chips, the CRAFT, BUILD and BIN buttons, the craft sheet
// (every recipe from the data: its inputs with what a01 has, its output's function and hint), the shelter's build sheet, the bin's
// manifest (the panels on it, what can be used), and the full-screen collect bubble the first time a01 collects a new kind of thing (its
// details, a 3D turntable of its model, its cryptic hint). All text is set as text (no HTML from data), every control is 44 px or more.
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const TIER_NAME = { 1: 'Tier 1', 2: 'Tier 2 · Matter Loom', 3: 'Tier 3 · Loom and a tier-2 machine' };
const CONCEPT_NOTE = { A_cage_hive: 'The first night: 10 pieces seal it (the dock charger, 7 mesh walls, the accordion gate, the workbench). Every piece is salvage: SALVAGE claims it where it lies, BUILD sets it in the glowing outline. No crafting needed; the patch roof is a bonus.',
  B_rack_fort: 'Mid-game: three pallet racks in a U round 4 m of floor, a pallet roof and the dock gate. Its racks, roof and gate need the Arc Forge (R15).',
  C_warehouse_bunker: 'Late game: two warehouse modules found in place (sunk to the floor), 10.5 x 5.5 m; 12 guard panels and two half gates close it, and need the Arc Forge.' };

export function createSurvivalUI({ $, survival, sim, sview, toast, audio, onPause = () => {}, compassName = () => '' }) {
  const cat = survival.cat, U = { open: null, queue: [], bubble: null, built: false };
  const name = (id) => (cat[id] ? cat[id].name : id);
  const sheets = ['craft', 'build', 'bag'];
  function close() { for (const s of sheets) $(s).hidden = true; U.open = null; }
  function openSheet(s) { close(); U.open = s; $(s).hidden = false; render(); }
  for (const s of sheets) { $(s + '-close').addEventListener('click', close); }
  $('craft-btn').addEventListener('click', () => openSheet('craft'));
  $('build-btn').addEventListener('click', () => openSheet('build'));
  $('bag-btn').addEventListener('click', () => openSheet('bag'));
  const render = () => { if (U.open === 'craft') renderCraft(); else if (U.open === 'build') renderBuild(); else if (U.open === 'bag') renderBag(); };

  // ---------------------------------------------------------------------------------------------- crafting
  function renderCraft() {
    const where = survival.where(), list = $('craft-list'); list.textContent = '';
    $('craft-where').textContent = where === 'shelter' ? 'In the shelter, at the workbench' : where === 'dock' ? 'Parked in Dock 01' : 'Not here: craft in your sealed shelter or parked in the dock';
    const ld = survival.inv.load(); $('craft-load').textContent = `Bin ${ld.kg.toFixed(1)} / ${survival.inv.cap.kg} kg · ${Math.round(ld.litres)} / ${survival.inv.cap.litres} L`;
    let tier = 0;
    const recs = survival.crafting.recipes.slice().sort((a, b) => a.tier - b.tier || (a.station ? 1 : 0) - (b.station ? 1 : 0));
    for (const r of recs) {
      if (r.tier !== tier) { tier = r.tier; list.append(el('p', 'craft-tier', TIER_NAME[tier] || 'Tier ' + tier)); }
      const c = survival.canCraft(r.id), out = cat[r.output] || {}, owned = survival.S.owned[r.id] || 0;
      const row = el('div', 'rcp' + (c.ok ? ' can' : '')); row.style.setProperty('--ac', out.accent || r.accent || '#38f3ff');
      const h = el('div', 'rcp-h'); h.append(el('b', '', r.name), el('span', 'rcp-id', r.id + (owned ? ` · made ${owned}` : '')));
      const ins = el('div', 'rcp-in');
      for (const [id, n] of Object.entries(r.inputs)) { const have = survival.inv.count(id) + (survival.state().where && sim.v2.arm.grasp && survival.idOfKind(sim.v2.arm.grasp.item.kind) === id ? 1 : 0); const chip = el('span', 'in' + (have >= n ? ' ok' : ''), `${name(id)} ${Math.min(have, n)}/${n}`); ins.append(chip); }
      const f = el('p', 'rcp-f', r.function), hint = el('p', 'rcp-hint', r.hint);
      const b = el('button', 'rcp-go', c.ok ? 'Craft' : 'Craft'); b.type = 'button'; b.disabled = !c.ok; b.dataset.id = r.id; b.setAttribute('aria-label', `Craft the ${r.name}`);
      b.addEventListener('click', () => doCraft(r.id));
      const why = el('p', 'rcp-why', c.ok ? '' : c.why);
      row.append(h, ins, f, hint, why, b); list.append(row);
    }
  }
  function doCraft(id) {
    const r = survival.craft(id);
    if (!r.ok) { toast(`Can't craft: ${r.why}.`, 'bad'); return; }
    audio.chime(20); toast(`${r.recipe.name} crafted.`, 'good', 2600); render();
  }

  // ---------------------------------------------------------------------------------------------- the shelter
  function renderBuild() {
    const box = $('build-body'); box.textContent = ''; const S = survival.shelter, st = survival.state();
    if (!S || !S.built.size) {
      box.append(el('p', 'lede', S ? `Site marked for the ${survival.shelters.kits[S.concept].name}. Build its first piece, or mark it again somewhere else.` : 'Choose a shelter and mark its site where a01 stands: a01 in its middle, its gate the way a01 faces. Shelters fit on clear, flat floor (in this town: the hall\'s open floor).'));
      for (const c of survival.shelters.concepts) {
        const k = survival.shelters.kits[c], card = el('div', 'concept');
        card.append(el('b', '', k.name), el('p', 'rcp-f', CONCEPT_NOTE[c] || k.when));
        // at the site "Find a site that fits" found (within a metre of it), that site; else where a01 stands, facing its way
        const a = survival.a01(), G0 = U.goal && U.goal.concept === c && Math.hypot(U.goal.x - a.x, U.goal.z - a.z) < 1.2 ? { x: U.goal.x, z: U.goal.z, yaw: U.goal.yaw } : null;
        const here = G0 || survival.siteHere(c), chk = survival.checkSite(c, here), msg = el('p', 'rcp-why', chk.ok ? 'It fits here.' : `Not here: ${chk.why}.`);
        const b = el('button', 'rcp-go', 'Mark the site here'); b.type = 'button'; b.disabled = !chk.ok;
        b.addEventListener('click', () => { const r = survival.markSite(c, here); if (r.ok) U.goal = null; if (!r.ok) toast(`Can't: ${r.why}.`, 'bad'); else { toast(`${k.name}: site marked. Bring its pieces and BUILD.`, 'good'); audio.clack(1); } render(); });
        const sug = el('button', 'ghost', 'Find a site that fits'); sug.type = 'button';
        sug.addEventListener('click', () => { const s = survival.suggest(c, 1)[0]; if (!s) { msg.textContent = 'No site fits anywhere now.'; return; } U.goal = { name: k.name.toUpperCase(), x: s.site.x, z: s.site.z, yaw: s.site.yaw, concept: c }; msg.textContent = `The nearest fit is ${s.d.toFixed(1)} m away, its gate facing ${['east', 'north', 'west', 'south'][((Math.round(s.site.yaw / (Math.PI / 2)) % 4) + 4) % 4]}: follow the compass and mark it there.`; });
        card.append(msg, b, sug); box.append(card);
      }
    }
    if (S) {
      const pr = survival.shelters.progress(S.concept, S.built, (id) => survival.inv.count(id), survival.S.owned), L = survival.layoutOf();
      box.append(el('p', 'craft-tier', `${survival.shelters.kits[S.concept].name} · ${pr.done} / ${pr.of} needed pieces${pr.sealed ? ' · sealed' : ''}`));
      const groups = survival.shelters.kits[S.concept].pieces;
      for (const g of groups) {
        const slots = L.filter((p) => p.item === g.item && p.g === groups.indexOf(g)), done = slots.filter((p) => S.built.has(p.key)).length;
        const row = el('div', 'piece' + (done === slots.length ? ' done' : ''));
        row.append(el('b', '', `${name(g.item)} ${done}/${slots.length}`), el('span', 'rcp-id', g.need ? (g.forge ? 'needed · Arc Forge' : 'needed') : 'optional'),
          el('span', 'rcp-id', g.found ? 'found in place' : `claimed ${survival.inv.count(g.item)}`));
        box.append(row);
      }
      const nx = pr.next ? `Next: the ${name(pr.next.item)}` : pr.blocked ? `Waiting: ${pr.blocked.why}` : 'Every piece is built.';
      box.append(el('p', 'rcp-why', nx));
      const b = el('button', 'cta', 'Build the next piece'); b.type = 'button'; b.disabled = !pr.next;
      b.addEventListener('click', () => { const r = survival.buildNext(); if (!r.ok) toast(`Can't build: ${r.why}.`, 'bad', 3200); else { toast(`The arm sets the ${name(r.piece.item)}.`, ''); close(); } });
      box.append(b);
    }
  }

  // ---------------------------------------------------------------------------------------------- the bin
  function renderBag() {
    const box = $('bag-body'); box.textContent = ''; const inv = survival.inv, st = survival.state(), oracle = !!survival.S.owned.R17;
    const ld = inv.load(); box.append(el('p', 'craft-tier', `The bin · ${ld.kg.toFixed(1)} / ${inv.cap.kg} kg · ${Math.round(ld.litres)} / ${inv.cap.litres} L`));
    const bar = el('div', 'pbar'), fill = el('span'); fill.style.width = `${Math.min(100, Math.max(ld.kg / inv.cap.kg, ld.litres / inv.cap.litres) * 100).toFixed(0)}%`; bar.append(fill); box.append(bar);
    const ids = Object.keys(inv.counts).sort((a, b) => name(a).localeCompare(name(b)));
    if (!ids.length) box.append(el('p', 'lede', 'Empty. GRAB loose supplies into it; SALVAGE strips bigger things (the rings on the ground).'));
    for (const id of ids) { const r = el('div', 'piece'); r.append(el('b', '', `${name(id)} × ${inv.counts[id]}`), el('span', 'rcp-id', cat[id].real || '')); box.append(r); }
    const cl = Object.keys(inv.claims); if (cl.length) { box.append(el('p', 'craft-tier', 'Claimed shelter pieces (built at the site)')); for (const id of cl) { const r = el('div', 'piece'); r.append(el('b', '', `${name(id)} × ${inv.claims[id]}`)); box.append(r); } }
    box.append(el('p', 'craft-tier', `Solar panels on the bin · ${st.panels} / 8 · ${st.night ? 'night: no sun' : st.solarW + ' W now'}`));
    const grid = el('div', 'slots8');
    survival.mounted.forEach((p, i) => { const c = el('div', 'pslot' + (p ? ' on ' + p.tier : '')); c.textContent = p ? (oracle ? `${p.tier} ${Math.round(p.eff * p.q * 100)}%` : p.tier) : (i < 8 ? 'empty' : ''); grid.append(c); });
    box.append(grid);
    if (inv.panels.length) box.append(el('p', 'rcp-f', `Loose panels in the bin: ${inv.panels.map((p) => (oracle ? `${p.tier} ${Math.round(p.eff * p.q * 100)}%` : p.tier)).join(', ')}. The Heliostat Rail (R02) mounts the best one.`));
    const uses = [['r24_small_vigil', 'Set down the Small Vigil', inv.count('r24_small_vigil') > 0], ['r22_contrast_syringe', 'Overdrive (Contrast Syringe)', survival.S.charges.syringe > 0], ['coolant', 'Use coolant', inv.count('coolant') > 0], ['pulse', 'Pulse the Skiagraph Pillar', !!survival.S.owned.R07]];
    for (const [id, label, on] of uses) { if (!on) continue; const b = el('button', 'ghost', label); b.type = 'button'; b.addEventListener('click', () => { const r = survival.use(id); toast(r.ok ? `${label}: done.` : `Can't: ${r.why}.`, r.ok ? 'good' : 'bad'); render(); }); box.append(b); }
    if (st.inside && st.night) { const b = el('button', 'cta', 'Wait for dawn'); b.type = 'button'; b.addEventListener('click', () => { const r = survival.waitForDawn(); toast(r.ok ? 'a01 sits out the night…' : `Can't: ${r.why}.`, r.ok ? '' : 'bad'); close(); }); box.append(b); }
    box.append(el('p', 'credits', 'Saved at the shelter: on its charging pad and at every dawn spent inside. Death starts again from the beginning.'));
  }

  // ---------------------------------------------------------------------------------------------- the collect bubble
  function bubbleNext() {
    if (U.bubble || !U.queue.length) return;
    const id = U.queue.shift(), e = cat[id]; if (!e) return bubbleNext();
    U.bubble = id; onPause(true);
    $('bubble').style.setProperty('--ac', e.accent || '#38f3ff');
    $('bub-kicker').textContent = e.category && /craft/.test(e.category) ? 'Crafted · first of its kind' : 'Collected · first of its kind';
    $('bub-name').textContent = e.name; $('bub-real').textContent = e.real || '';
    const st = $('bub-stats'); st.textContent = '';
    const row = (k, v) => { if (v == null || v === '') return; const d = el('div', 'bs'); d.append(el('span', 'bs-k', k), el('span', 'bs-v', v)); st.append(d); };
    row('kind', [e.category, e.rarity].filter(Boolean).join(' · ')); row('found', (e.found || []).join(', '));
    // (a salvage site's size is the thing as it stands, stripped in place; what goes into the bin is the next row)
    if (e.stats && e.stats.size_m) row(e.game && e.game.salvage ? 'as found' : 'size', e.stats.size_m.map((v) => v.toFixed(2)).join(' × ') + ' m');
    const carry = e.game && e.game.carry; if (carry && carry[0]) row('in the bin', `${carry[0]} kg · ${carry[1]} L`);
    if (e.recipes && e.recipes.length) row('feeds', e.recipes.join(' '));
    $('bub-func').textContent = e.function || ''; $('bub-hint').textContent = e.hint || '';
    $('bubble').hidden = false; $('hud').classList.add('dim');
    sview.bubbleOpen(id);
    audio.chime(e.rarity === 'rare' || e.rarity === 'crafted' ? 25 : 8);
  }
  function bubbleClose() { if (!U.bubble) return; U.bubble = null; $('bubble').hidden = true; $('hud').classList.remove('dim'); sview.bubbleClose(); onPause(false); setTimeout(bubbleNext, 250); }
  $('bub-ok').addEventListener('click', bubbleClose);

  // ---------------------------------------------------------------------------------------------- events, HUD
  function onEvents(evs) {
    for (const e of evs) {
      if (e.type === 'collect') { if (e.first) U.queue.push(e.id); else if (e.how === 'salvage') toast(`Salvaged: ${name(e.id)}${e.n > 1 ? ' × ' + e.n : ''}`, 'good'); else if (e.how === 'courier') toast(`The Mole Courier brought a ${name(e.id)}.`, 'good'); else toast(`Into the bin: ${name(e.id)}`, '', 1400); }
      else if (e.type === 'crafted') { if (e.first) U.queue.push(e.output); }
      else if (e.type === 'dayLeeches') { toast(`Day ${e.day}: the leeches no longer wait for the dark. ${e.n} out by day.`, 'bad', 4200); }
      else if (e.type === 'night') { toast(`Night ${e.day}. The leeches are out: get inside your shelter.`, 'bad', 4200); audio.sting && audio.sting(); }
      else if (e.type === 'dawn') toast(`Dawn, day ${e.day}. The leeches melt back into the puddles.`, 'good', 3600);
      else if (e.type === 'latched') { toast(`A leech has latched on! ${e.n > 1 ? e.n + ' draining' : 'It drains 1.5 % a second'}: back inside the shelter.`, 'bad', 3200); audio.thump(0.8); }
      else if (e.type === 'detach') toast(e.why === 'shelter' ? 'Inside: the leech lets go.' : 'UV light: the leech lets go.', 'good');
      else if (e.type === 'zapped') { toast(`Zapped off by the ${e.by}.`, 'good'); audio.clack(1.5); }
      else if (e.type === 'revived') toast('The Lazarus Clamps brought a01 back: 25 %.', 'good', 3600);
      else if (e.type === 'built') { audio.thump(0.6); toast(e.sealed ? 'Sealed: the shelter keeps the leeches out.' : `Built: ${name(e.item)} (${e.done}/${e.of})`, e.sealed ? 'good' : '', 2200); }
      else if (e.type === 'saved' && e.ok && e.why !== 'pad') toast('Saved.', 'good', 1200);
      else if (e.type === 'warn') toast('The Warmth Eye: leeches close, about 30 s away.', 'bad', 3600);
      else if (e.type === 'furnace') toast('The Roentgen Furnace burns a diesel can: +10 %.', 'good', 1600);
      else if (e.type === 'revealed') toast(`Found buried: ${name(survival.idOfKind(e.kind) || e.kind)}`, 'good');
    }
    if (evs.some((e) => ['collect', 'crafted', 'built', 'salvaged', 'station', 'site'].includes(e.type))) render();
    bubbleNext();
  }
  function hud() {
    const st = survival.state(), on = st.active;
    $('clock-chip').hidden = !on; $('craft-btn').classList.toggle('off', !on); $('build-btn').classList.toggle('off', !on); $('bag-btn').classList.toggle('off', !on);
    if (!on) { $('leech-chip').hidden = true; $('sun-chip').hidden = true; return; }
    $('clock-chip').textContent = `DAY ${st.day} · ${st.clock}${st.waiting ? ' »' : ''}`; $('clock-chip').classList.toggle('night', st.night);
    $('leech-chip').hidden = !(st.near || st.latched); $('leech-chip').textContent = st.latched ? `LEECHES ON a01 · ${st.latched}` : `LEECHES NEAR · ${st.near}`;
    $('sun-chip').hidden = !st.panels; $('sun-chip').textContent = st.night ? `NIGHT · ${st.panels} PANELS` : `SOLAR +${st.solarW} W`;
    $('craft-btn').classList.toggle('ready', !!st.where);
    $('build-btn').classList.toggle('ready', !!(st.shelter && !st.shelter.sealed && st.shelter.next));
    if (U.open === 'bag' || U.open === 'craft') { U.tick = (U.tick || 0) + 1; if (U.tick % 10 === 0) render(); }
  }
  return { onEvents, hud, close, openSheet, render, bubbleClose, get bubble() { return U.bubble; }, get goal() { return U.goal; }, set goal(g) { U.goal = g; }, queue: U.queue };
}
