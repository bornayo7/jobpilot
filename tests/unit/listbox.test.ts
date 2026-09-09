import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pickFromListbox } from '@lib/fill/dom/pickFromListbox';
beforeEach(() => { document.body.innerHTML = ''; vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

it('settles a detached typeahead without activating a replacement widget option', async () => {
  document.body.innerHTML = '<input name="other" /><input role="combobox" aria-controls="pending" />';
  const trigger = document.querySelector<HTMLElement>('[role="combobox"]')!;
  const result = pickFromListbox(trigger, 'Austin');
  trigger.remove();
  document.body.insertAdjacentHTML('beforeend', '<input role="combobox" aria-controls="pending" /><ul id="pending" role="listbox"><li role="option">Austin</li></ul>');
  const clicked = vi.fn(); document.querySelector('li')!.addEventListener('click', clicked);
  await vi.advanceTimersByTimeAsync(300);
  expect(await result).toMatchObject({ ok: false }); expect(clicked).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('matches No as a whole word instead of selecting Now', async () => {
  document.body.innerHTML = '<input role="combobox" /><ul role="listbox"><li role="option">Now or later</li><li role="option">No, I do not</li></ul>';
  const options = document.querySelectorAll('li'); const wrong = vi.fn(); const right = vi.fn();
  options[0]!.addEventListener('click', wrong); options[1]!.addEventListener('click', () => { right(); options[1]!.setAttribute('aria-selected','true'); });
  const result = pickFromListbox(document.querySelector('input')!, 'No');
  await vi.advanceTimersByTimeAsync(300);
  expect(await result).toMatchObject({ ok: true, verifiedValue:'No, I do not' });
  expect(wrong).not.toHaveBeenCalled(); expect(right).toHaveBeenCalledOnce();
});

it('only clicks visible enabled options in the associated listbox', async () => {
  document.body.innerHTML = `
    <input role="combobox" aria-controls="mine" />
    <ul role="listbox"><li role="option">Austin</li></ul>
    <ul id="mine" role="listbox">
      <li role="option" hidden>Austin</li><li role="option" aria-disabled="true">Austin</li>
      <li role="option">Austin, TX</li>
    </ul>`;
  const clicked: string[] = [];
  document.querySelectorAll('li').forEach((el, i) => el.addEventListener('click', () => { clicked.push(String(i)); el.setAttribute('aria-selected','true'); }));
  const result = pickFromListbox(document.querySelector('input')!, 'Austin');
  await vi.advanceTimersByTimeAsync(300);
  expect(await result).toMatchObject({ ok: true, verifiedValue:'Austin, TX' });
  expect(clicked).toEqual(['3']);
});

it('does not report an ignored click as a committed selection', async () => {
  document.body.innerHTML = '<button role="combobox" aria-controls="mine">Choose</button><ul id="mine" role="listbox"><li role="option">Austin</li></ul>';
  const result = pickFromListbox(document.querySelector('button')!, 'Austin');
  await vi.advanceTimersByTimeAsync(1000);
  expect(await result).toMatchObject({ok:false});
});

it('rejects a reverted trigger even when its old option still says selected', async () => {
  document.body.innerHTML = '<input role="combobox" aria-controls="mine" /><ul id="mine" role="listbox"><li role="option">Austin</li></ul>';
  const input = document.querySelector('input')!;
  document.querySelector('li')!.addEventListener('click', (event) => {
    (event.currentTarget as HTMLElement).setAttribute('aria-selected', 'true');
    setTimeout(() => { input.value = ''; }, 150);
  });
  const result = pickFromListbox(input, 'Austin'); await vi.advanceTimersByTimeAsync(1000);
  expect(await result).toMatchObject({ ok: false });
});

it('does not fall back to another dropdown while the associated listbox is absent', async () => {
  document.body.innerHTML = '<input role="combobox" aria-controls="pending" /><ul role="listbox"><li role="option">No</li></ul>';
  const click = vi.fn(); document.querySelector('li')!.addEventListener('click', click);
  const result = pickFromListbox(document.querySelector('input')!, 'No', 10);
  await vi.advanceTimersByTimeAsync(300);
  expect(await result).toMatchObject({ ok: false }); expect(click).not.toHaveBeenCalled();
});
