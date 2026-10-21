// Plate calculator: what to put on each side of the bar for a given weight.

import { getSettings, saveSettings } from '../store.js';
import { sheet, esc } from '../ui.js';
import {
  platesFor, DEFAULT_PLATES, BAR_EQUIPMENT,
  toDisplayWeight, toStoredWeight, fmtNum,
} from '../util.js';
import { EQUIPMENT } from '../exercises.js';

const round2 = (v) => Math.round(v * 100) / 100;

/** The plates you have, in the display unit. */
export function platesInUnit(settings = getSettings()) {
  const unit = settings.unit;
  if (!settings.plates?.length) return DEFAULT_PLATES[unit];
  return settings.plates.map((kg) => round2(toDisplayWeight(kg, unit)));
}

function barInUnit(equipment, settings = getSettings()) {
  const kg = settings.bars?.[equipment];
  if (kg != null) return round2(toDisplayWeight(kg, settings.unit));
  return (BAR_EQUIPMENT[equipment] || BAR_EQUIPMENT.barbell)[settings.unit];
}

/** Opens the calculator for `kg` (may be null) on the given equipment's bar. */
export function openPlateCalculator({ kg, equipment = 'barbell' }) {
  const unit = getSettings().unit;
  const target = kg == null ? '' : round2(toDisplayWeight(kg, unit));

  sheet({
    title: 'Plate calculator',
    bodyHtml: `
      <div class="stack">
        <div class="plate-inputs">
          <label><span>Target (${esc(unit)})</span>
            <input class="input num" data-f="target" inputmode="decimal" value="${esc(target)}" placeholder="—"></label>
          <label><span>${esc(EQUIPMENT[equipment] || 'Bar')} (${esc(unit)})</span>
            <input class="input num" data-f="bar" inputmode="decimal" value="${esc(barInUnit(equipment))}"></label>
        </div>
        <div class="plate-viz" aria-hidden="true"></div>
        <p class="plate-result" data-result aria-live="polite"></p>
        <p class="muted small">Plates: ${esc(platesInUnit().map((p) => fmtNum(p, 2)).join(', '))} ${esc(unit)}, in pairs. Change them in Settings.</p>
      </div>`,
    onMount(body) {
      const targetEl = body.querySelector('[data-f="target"]');
      const barEl = body.querySelector('[data-f="bar"]');
      const viz = body.querySelector('.plate-viz');
      const result = body.querySelector('[data-result]');
      const plates = platesInUnit();
      const biggest = Math.max(...plates);

      const draw = () => {
        const total = parseFloat(targetEl.value);
        const bar = parseFloat(barEl.value) || 0;
        viz.innerHTML = '';
        if (!(total > 0)) {
          result.textContent = 'Enter a weight to see the plates.';
          return;
        }
        const { perSide, loaded, off } = platesFor(total, bar, plates);
        // The right half of the bar, from the shaft outwards: inner collar,
        // heaviest plate first, then the sleeve end.
        viz.innerHTML =
          '<span class="plate-collar"></span>' +
          perSide
            .map(
              (p) =>
                `<span class="plate" style="height:${Math.round(38 + 62 * (p / biggest))}%">${esc(fmtNum(p, 2))}</span>`
            )
            .join('') +
          '<span class="plate-sleeve"></span>';
        const w = (v) => `${fmtNum(v, 2)} ${unit}`;
        if (off < 0) {
          result.textContent = `That's lighter than the bar (${w(bar)}).`;
        } else if (!perSide.length) {
          result.textContent = 'Just the bar.';
        } else {
          const side = `Each side: ${perSide.map((p) => fmtNum(p, 2)).join(' + ')}`;
          result.textContent = off > 0 ? `${side} — loads ${w(loaded)}, ${w(off)} short of ${w(total)}.` : `${side}.`;
        }
      };

      targetEl.addEventListener('input', draw);
      barEl.addEventListener('input', draw);
      barEl.addEventListener('change', () => {
        const v = parseFloat(barEl.value);
        // Remembered per kind of bar; blank goes back to the standard one.
        const bars = { ...getSettings().bars };
        if (v >= 0) bars[equipment] = toStoredWeight(v, getSettings().unit);
        else delete bars[equipment];
        saveSettings({ bars });
      });
      draw();
    },
  });
}
