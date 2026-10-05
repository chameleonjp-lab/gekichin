import { Quaternion, Vector3 } from 'three';

/** Locally synthesized effects. No external recordings or downloaded assets. */
export type CombatSound =
  | 'machinegun'
  | 'cannon'
  | 'enemy-machinegun'
  | 'main-warning'
  | 'metal-impact'
  | 'turret-destroy'
  | 'mothership-sink';

type Voice = {
  oscillator: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
  until: number;
};

const MAX_VOICES = 16;
const PROP_VOICE = 0;

/** One lazily-created Web Audio context, with a fixed sixteen-voice synth pool. */
export class FlightAudio {
  private context: AudioContext | null = null;
  private voices: Voice[] = [];
  private master: GainNode | null = null;
  private enabled = false;
  private active = false;
  private propellerActive = false;
  private contextTransition: Promise<void> = Promise.resolve();

  get isEnabled(): boolean { return this.enabled; }

  /** Read-only live Web Audio resources and bounded voice-pool occupancy. */
  get diagnostics(): Readonly<{
    contexts: number;
    voices: number;
    maxVoices: number;
    activeVoices: number;
    effectVoices: number;
    propellerActive: boolean;
    enabled: boolean;
    active: boolean;
    contextState: AudioContextState | 'absent';
  }> {
    const context = this.context;
    const audible = Boolean(context && this.enabled && this.active && context.state === 'running');
    const effectVoices = audible
      ? this.voices.slice(1).reduce((count, voice) => count + Number(voice.until > context!.currentTime), 0)
      : 0;
    const propellerActive = Boolean(audible && this.propellerActive);
    return Object.freeze({
      contexts: Number(context !== null),
      voices: this.voices.length,
      maxVoices: MAX_VOICES,
      activeVoices: effectVoices + Number(propellerActive),
      effectVoices,
      propellerActive,
      enabled: this.enabled,
      active: this.active,
      contextState: context?.state ?? 'absent',
    });
  }

  /** Audio stays off until the user explicitly activates it. */
  async toggle(): Promise<boolean> {
    if (this.enabled) {
      this.enabled = false;
      await this.sync();
      return false;
    }
    try {
      this.ensureContext();
      this.enabled = true;
      await this.sync();
      return this.enabled;
    } catch {
      this.enabled = false;
      await this.sync().catch(() => {});
      return false;
    }
  }

  /** Called for the currently running operation; hidden and paused states suspend audio. */
  setActive(active: boolean): void {
    this.active = active;
    void this.sync().catch(() => {});
  }

  update(speed: number): void {
    if (!this.context || this.voices.length === 0) return;
    const voice = this.voices[PROP_VOICE];
    const now = this.context.currentTime;
    voice.oscillator.frequency.setTargetAtTime(48 + Math.max(0, speed) * 0.23, now, 0.08);
    this.propellerActive = true;
    if (this.master && this.enabled && this.active && this.context.state === 'running') {
      voice.gain.gain.setTargetAtTime(0.035, now, 0.04);
    }
  }

  /**
   * Schedule a short spatialized combat cue. Events are ignored while sound is
   * off or the operation is paused. The listener pose should match the view.
   */
  playCombat(
    kind: CombatSound,
    source: Vector3,
    listener: Vector3,
    listenerRotation: Quaternion,
  ): void {
    if (!this.enabled || !this.active || !this.context || this.context.state !== 'running') return;
    if (this.voices.length !== MAX_VOICES) return;

    const now = this.context.currentTime;
    const slot = this.findVoice(now);
    const voice = this.voices[slot];
    const relative = source.clone().sub(listener);
    const distance = relative.length();
    const right = new Vector3(1, 0, 0).applyQuaternion(listenerRotation);
    const pan = distance > 0.001 ? Math.max(-1, Math.min(1, relative.normalize().dot(right))) : 0;
    const attenuation = 1 / (1 + Math.pow(distance / (kind === 'mothership-sink' ? 1400 : 620), 1.25));
    const profile = profileFor(kind);
    const gain = profile.gain * attenuation;
    const oscillator = voice.oscillator;
    const filter = voice.filter;
    const amplitude = voice.gain.gain;

    oscillator.type = profile.wave;
    oscillator.frequency.cancelScheduledValues(now);
    oscillator.frequency.setValueAtTime(profile.startHz, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, profile.endHz), now + profile.duration);
    filter.frequency.cancelScheduledValues(now);
    filter.frequency.setValueAtTime(profile.cutoff, now);
    voice.pan.pan.setTargetAtTime(pan, now, 0.015);
    amplitude.cancelScheduledValues(now);
    amplitude.setValueAtTime(0.0001, now);
    amplitude.linearRampToValueAtTime(Math.max(0.0001, gain), now + profile.attack);
    amplitude.exponentialRampToValueAtTime(0.0001, now + profile.duration);

    voice.until = now + profile.duration;
  }

  private findVoice(now: number): number {
    // Slot zero belongs to the continuous propeller; combat uses the other 15.
    for (let index = 1; index < this.voices.length; index += 1) {
      if (this.voices[index].until <= now) return index;
    }
    let oldest = 1;
    for (let index = 2; index < this.voices.length; index += 1) {
      if (this.voices[index].until < this.voices[oldest].until) oldest = index;
    }
    return oldest;
  }

  private ensureContext(): void {
    if (this.context) return;
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0.32;
    master.connect(context.destination);
    this.context = context;
    this.master = master;

    for (let index = 0; index < MAX_VOICES; index += 1) {
      const oscillator = context.createOscillator();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      const pan = context.createStereoPanner();
      oscillator.type = index === PROP_VOICE ? 'sawtooth' : 'triangle';
      oscillator.frequency.value = index === PROP_VOICE ? 55 : 440;
      filter.type = 'lowpass';
      filter.frequency.value = index === PROP_VOICE ? 240 : 1600;
      gain.gain.value = 0;
      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(pan);
      pan.connect(master);
      oscillator.start();
      this.voices.push({ oscillator, filter, gain, pan, until: 0 });
    }
  }

  private sync(): Promise<void> {
    if (!this.context || !this.master || this.voices.length === 0) return Promise.resolve();
    const context = this.context;
    const now = context.currentTime;
    const audible = this.enabled && this.active;
    this.master.gain.setTargetAtTime(audible ? 0.32 : 0, now, 0.025);
    const propeller = this.voices[PROP_VOICE];
    propeller.gain.gain.setTargetAtTime(audible && this.propellerActive ? 0.035 : 0, now, 0.025);
    if (!audible) {
      for (let index = 1; index < this.voices.length; index += 1) {
        const voice = this.voices[index];
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(0, now);
        voice.until = now;
      }
    }
    // Serialize suspend/resume requests and re-read the desired state when a
    // queued transition runs. Otherwise a pending pause suspend can win a race
    // with an immediate resume and leave an ON channel silent.
    this.contextTransition = this.contextTransition.catch(() => {}).then(async () => {
      if (this.context !== context || context.state === 'closed') return;
      if (this.enabled && this.active) {
        if (context.state !== 'running') await context.resume();
      } else if (context.state === 'running') {
        await context.suspend();
      }
    });
    return this.contextTransition;
  }

  dispose(): void {
    this.enabled = false;
    for (const voice of this.voices) {
      try { voice.oscillator.stop(); } catch { /* already stopped */ }
      voice.oscillator.disconnect();
      voice.filter.disconnect();
      voice.gain.disconnect();
      voice.pan.disconnect();
    }
    if (this.master) this.master.disconnect();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    this.master = null;
    this.voices = [];
    this.propellerActive = false;
  }
}

type SoundProfile = { wave: OscillatorType; startHz: number; endHz: number; cutoff: number; gain: number; attack: number; duration: number };

function profileFor(kind: CombatSound): SoundProfile {
  switch (kind) {
    case 'machinegun':
      return { wave: 'square', startHz: 760, endHz: 420, cutoff: 1900, gain: 0.18, attack: 0.003, duration: 0.055 };
    case 'cannon':
      return { wave: 'sawtooth', startHz: 185, endHz: 48, cutoff: 620, gain: 0.34, attack: 0.012, duration: 0.34 };
    case 'enemy-machinegun':
      return { wave: 'square', startHz: 1080, endHz: 620, cutoff: 2500, gain: 0.15, attack: 0.002, duration: 0.06 };
    case 'main-warning':
      return { wave: 'square', startHz: 920, endHz: 660, cutoff: 1900, gain: 0.14, attack: 0.008, duration: 0.22 };
    case 'metal-impact':
      return { wave: 'triangle', startHz: 1680, endHz: 420, cutoff: 3000, gain: 0.2, attack: 0.001, duration: 0.12 };
    case 'turret-destroy':
      return { wave: 'sawtooth', startHz: 640, endHz: 55, cutoff: 2100, gain: 0.23, attack: 0.004, duration: 0.46 };
    case 'mothership-sink':
      return { wave: 'sawtooth', startHz: 130, endHz: 24, cutoff: 360, gain: 0.42, attack: 0.08, duration: 1.5 };
  }
}
