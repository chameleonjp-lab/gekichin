/** Unscaled layout-CSS-pixel centre rectangles shared by live placement, preview and Save. */
export type ControlObstacle = { x: number; y: number; width: number; height: number; control?: 'fire' | 'loop' };
export type HudObstacleOptions = {
  mode?: 'normal' | 'easy';
  controls?: Partial<Record<'fire' | 'loop', Readonly<Record<string, string>>>>;
};

/** offset dimensions exclude CSS zoom/transforms, matching the CSS size written by settings. */
export function controlLayoutSize(element: HTMLElement): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  return { width: element.offsetWidth || rect.width, height: element.offsetHeight || rect.height };
}

/** Measure only a detached copy of the HUD, including when the real HUD is hidden.
 * No real visibility, focus, listeners or saved positions are changed. The clone
 * has the current app dimensions and inherited CSS, including font zoom/safe area.
 * Candidate peer styles replace the clone's old saved styles before measurement,
 * so responsive CSS overrides and pending settings edits share one geometry.
 */
export function measureHudObstacles(app: HTMLElement, options: HudObstacleOptions = {}): ControlObstacle[] {
  const hud = app.querySelector<HTMLElement>('#hud');
  const rect = controlLayoutSize(app);
  if (!hud || typeof app.cloneNode !== 'function' || !(rect.width > 0 && rect.height > 0)) return [];
  const host = app.cloneNode(false) as HTMLElement;
  host.removeAttribute('hidden');
  const mode = options.mode ?? 'normal';
  host.classList.add('playing'); host.classList.toggle('easy-mode', mode === 'easy');
  host.dataset.phase = 'playing'; host.dataset.mode = mode; host.dataset.screen = 'playing';
  host.inert = true; host.setAttribute('aria-hidden', 'true');
  for (const [property,value] of Object.entries({ position:'fixed', left:'-100000px', top:'0', right:'auto', bottom:'auto', width:`${rect.width}px`, height:`${rect.height}px`, minWidth:'0', maxWidth:'none', minHeight:'0', maxHeight:'none', margin:'0', transform:'translateZ(0)', visibility:'hidden', pointerEvents:'none' })) {
    host.style.setProperty(property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`),value,'important');
  }
  const copy = hud.cloneNode(true) as HTMLElement;
  copy.removeAttribute('hidden');
  const peers = new Map<HTMLElement, 'fire' | 'loop'>();
  for (const name of ['fire', 'loop'] as const) {
    const properties = options.controls?.[name];
    const element = copy.querySelector<HTMLElement>(`#${name}`);
    if (!properties || !element) continue;
    element.hidden = mode === 'easy' && name === 'fire';
    for (const [property, value] of Object.entries(properties)) element.style.setProperty(property, value);
    peers.set(element, name);
  }
  host.append(copy);
  app.parentElement?.append(host);
  try {
    if (!host.isConnected) return [];
    const origin = host.getBoundingClientRect();
    const scaleX = rect.width / origin.width, scaleY = rect.height / origin.height;
    const elements = new Set([...copy.querySelectorAll<HTMLElement>('button:not(.action-control):not(.flight-button):not([data-flight-control]), .combat-panel > summary'), ...peers.keys()]);
    return [...elements]
      .filter(element => !element.hidden && !element.closest('[hidden]'))
      .map(element => ({ element, item: element.getBoundingClientRect() }))
      .filter(({ item }) => item.width > 0 && item.height > 0)
      .map(({ element, item }) => ({ x:(item.left-origin.left+item.width/2)*scaleX, y:(item.top-origin.top+item.height/2)*scaleY,
        width:item.width*scaleX, height:item.height*scaleY, ...(peers.has(element) ? { control: peers.get(element) } : {}) }));
  } finally { host.remove(); }
}

/** Convert visual viewport pixels into the editor's unscaled layout space.
 * getBoundingClientRect includes inherited zoom/transforms; offsets do not.
 */
export function settingsViewportSize(element: HTMLElement, width: number, height: number): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  const x = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1;
  const y = element.offsetHeight > 0 ? rect.height / element.offsetHeight : 1;
  return { width: width / (Number.isFinite(x) && x > 0 ? x : 1),
    height: height / (Number.isFinite(y) && y > 0 ? y : 1) };
}
