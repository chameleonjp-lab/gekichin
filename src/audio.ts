/** Locally generated P1 propeller preview. Combat sounds are deferred to P6. */
export class FlightAudio {
  private context: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private enabled = false;
  private active = false;

  get isEnabled(): boolean { return this.enabled; }

  async toggle(): Promise<boolean> {
    this.enabled = !this.enabled;
    if (!this.enabled) { this.sync(); return false; }
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.oscillator = this.context.createOscillator();
        this.oscillator.type = 'sawtooth';
        this.oscillator.frequency.value = 72;
        const filter = this.context.createBiquadFilter();
        filter.type = 'lowpass'; filter.frequency.value = 220;
        this.gain = this.context.createGain(); this.gain.gain.value = 0;
        this.oscillator.connect(filter); filter.connect(this.gain); this.gain.connect(this.context.destination);
        this.oscillator.start();
      }
      await this.context.resume();
      this.sync();
      return this.enabled;
    } catch {
      this.enabled = false;
      this.sync();
      return false;
    }
  }

  setActive(active: boolean): void { this.active = active; this.sync(); }

  update(speed: number): void {
    if (this.context && this.oscillator) this.oscillator.frequency.setTargetAtTime(45 + speed * 0.25, this.context.currentTime, 0.1);
  }

  private sync(): void {
    if (!this.context || !this.gain) return;
    const audible = this.enabled && this.active;
    this.gain.gain.setTargetAtTime(audible ? 0.035 : 0, this.context.currentTime, 0.025);
    if (!audible) void this.context.suspend().catch(() => {});
    else void this.context.resume().catch(() => {});
  }

  dispose(): void {
    this.enabled = false;
    this.oscillator?.stop();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null; this.oscillator = null; this.gain = null;
  }
}
