import {
  AgXToneMapping,
  Box3,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Timer,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CameraDirector } from '../cameras/CameraDirector';
import type { AudioFrame, Vec3 } from '../audio/AudioEngine';
import { LiveAudio } from '../audio/LiveAudio';
import { WIND } from '../config/aero';
import { AIRFRAMES, withPayload } from '../config/airframes';
import { DRONE, LEDS, MODEL_CREDIT, PROP_BLEND } from '../config/drone';
import { PHYSICS } from '../config/physics';
import { FIELD_RENDER } from '../config/field';
import { createField, type FieldView } from '../render/field';
import { buildFieldLayout, type FieldLayout } from '../world/fieldLayout';
import { Terrain } from '../world/terrain';
import type { FlightSim } from '../sim/flight/FlightSim';
import { QUALITY, RENDER, type QualityPreset } from '../config/render';
import { DroneModel } from '../drone/DroneModel';
import { createBench } from '../render/bench';
import { createEnvironment, type Environment } from '../render/environment';
import { aimKeyLight, createKeyLight, setShadowMapSize } from '../render/lighting';
import { LookUniforms } from '../render/cameraLook';
import { PostPipeline } from '../render/pipeline';
import { QualityController } from '../render/quality';
import { InputManager } from '../input/InputManager';
import { calibrationStore, RadioInput } from '../input/RadioInput';
import type { ControlState } from '../input/types';
import { Powertrain } from '../sim/Powertrain';
import type { PowerEvent } from '../sim/PowerStateMachine';
import { mountAudioPrompt } from '../ui/AudioPrompt';
import { OsdOverlay } from '../ui/OSD';
import { CalibrationWizard } from '../ui/CalibrationWizard';
import { Hud } from '../ui/Hud';
import { InputVisualizer } from '../ui/InputVisualizer';
import { MotorTestPanel, type MotorTestStatus } from '../ui/MotorTestPanel';
import { SettingsPanel } from '../ui/SettingsPanel';
import { armBlockedMessage, Toast } from '../ui/Toast';
import { readParams } from './params';
import { applyConfigSettings, fromBf, loadSettings, saveSettings, type Settings } from './settings';
import type { FlightMode } from '../config/fc';
import { exposeDebug } from './debug';

export class App {
  readonly scene = new Scene();
  /** The orbit/inspect camera (OrbitControls drives it). */
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly cameras: CameraDirector;
  readonly osd: OsdOverlay;
  /** Betaflight fly time: seconds armed since the battery was plugged in. */
  armedTimeS = 0;
  /** HD view recording time (starts when the view is entered). */
  recTimeS = 0;
  readonly quality: QualityController;
  drone!: DroneModel;
  environment!: Environment;
  readonly powertrain = new Powertrain();
  readonly input = new InputManager();
  readonly inputViz: InputVisualizer;
  /** H: hide the HUD (the OSD stays, it's part of the video). */
  uiHidden = false;
  /** Last frame's control state (debug / HUD). */
  controlState: ControlState | null = null;
  settings: Settings;
  readonly hud: Hud;
  readonly motorPanel: MotorTestPanel;
  readonly settingsPanel: SettingsPanel;
  /** Smoothed frames per second (HUD, when enabled). */
  fps = 0;
  /** Flight physics (Phase 2), once Rapier has loaded; null on the bench (`?flight=0`). */
  flight: FlightSim | null = null;
  private lastDronePos = new Vector3();
  /** The orbit view follows the drone in flight (recordings turn it off for a fixed shot). */
  followDrone = true;
  /** The flight test field (Phase 2 §5), built when flight is on. */
  field: { terrain: Terrain; layout: FieldLayout; view: FieldView } | null = null;
  private windV = new Vector3();
  readonly audio = new LiveAudio();
  /** Debug/verification: fixed prop RPM instead of the motor model (null = model). */
  rpmOverride: number[] | null = null;
  /** Debug/verification: fixed throttle instead of the keyboard (null = keyboard). */
  throttleOverride: number | null = null;
  /** Debug/verification: fixed roll/pitch/yaw sticks (null = the input devices). */
  sticksOverride: { roll: number; pitch: number; yaw: number } | null = null;
  /** When frozen, the simulation clock stops but frames keep rendering (for screenshots). */
  simFrozen = false;
  /** Tests: keep input + sim + audio running each frame but skip drawing (software GL is slow). */
  renderPaused = false;
  readonly toast: Toast;
  /** Power events from the last frame (debug/HUD). */
  lastEvents: PowerEvent[] = [];
  private prevRpms = [0, 0, 0, 0];
  private v = new Vector3();
  private pendingStep = 0;
  private post: PostPipeline;
  private key;
  private padTopY = 0;
  private timer = new Timer();
  private running = false;

  static async create(container: HTMLElement): Promise<App> {
    const renderer = new WebGPURenderer({ antialias: false });
    await renderer.init();
    const app = new App(container, renderer);
    await app.load();
    app.start();
    return app;
  }

  private constructor(
    private container: HTMLElement,
    readonly renderer: WebGPURenderer,
  ) {
    const params = readParams();
    this.settings = loadSettings();
    applyConfigSettings(this.settings);
    renderer.toneMapping = AgXToneMapping;
    renderer.toneMappingExposure = RENDER.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    container.appendChild(renderer.domElement);

    const { camera: cam, orbit } = RENDER;
    this.camera = new PerspectiveCamera(cam.fov, 1, cam.near, cam.far);
    this.camera.position.set(...cam.position);
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = orbit.damping;
    this.controls.minDistance = orbit.minDistance;
    this.controls.maxDistance = orbit.maxDistance;
    this.controls.autoRotateSpeed = orbit.autoRotateSpeed;

    this.quality = new QualityController({
      forced: params.quality ?? (this.settings.quality === 'auto' ? null : this.settings.quality),
      dynamicResolution: params.dynamicResolution,
      onPreset: (p) => this.applyPreset(p),
      onScale: () => this.resize(),
    });
    this.key = createKeyLight(this.scene, QUALITY[this.quality.preset].shadowMapSize);
    const look = new LookUniforms();
    this.cameras = new CameraDirector(this.camera, this.controls, look, (kind) => this.post.setView(kind));
    this.cameras.onChange = (mode) => {
      document.body.classList.toggle('pw-feed-view', mode !== 'orbit');
      if (mode === 'hd') this.recTimeS = 0;
    };
    this.post = new PostPipeline(renderer, this.scene, this.cameras.renderCamera, look);
    this.post.build(QUALITY[this.quality.preset]);

    this.timer.connect(document);
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
    this.osd = new OsdOverlay(container);
    mountAudioPrompt(this.audio);
    this.toast = new Toast();
    this.inputViz = new InputVisualizer();
    this.inputViz.onCalibrate = () => this.calibrateRadio();
    this.hud = new Hud();
    this.motorPanel = new MotorTestPanel();
    this.settingsPanel = new SettingsPanel(this.settings, MODEL_CREDIT);
    this.hud.onMotors = () => this.toggleMotorPanel();
    this.hud.onSettings = () => this.toggleSettings();
    this.settingsPanel.onCalibrate = () => this.calibrateRadio();
    this.settingsPanel.onChange = (s) => {
      this.settings = s;
      this.applySettings();
      saveSettings(s);
    };
    this.input.onDevice = (event, d) => {
      if (event === 'disconnected') return this.toast.show(`<b>${d.name}</b> disconnected`, 2000);
      if (d.kind === 'gamepad')
        this.toast.show(
          `<b>${d.name}</b> connected · R2 throttle · R1 arm · L1+R1 kill · hold Options for the battery`,
          4200,
        );
      else if (!calibrationStore.load(this.input.pads.get(d.index)?.id ?? ''))
        this.toast.show(`<b>${d.name}</b> connected as an RC radio: press <b>Calibrate radio</b>`, 4200);
      else this.toast.show(`<b>${d.name}</b> connected (calibrated)`, 2000);
    };
    this.resize();
  }

  private async load(): Promise<void> {
    const params = readParams();
    const bench = createBench();
    this.padTopY = bench.padTopY;
    this.scene.add(bench.group);
    const [env, drone] = await Promise.all([createEnvironment(this.scene), DroneModel.load()]);
    this.environment = env;
    if (params.flight) {
      // The test field replaces the bench floor (the pad stays); the physics gets the same field.
      const terrain = new Terrain();
      const layout = buildFieldLayout(terrain);
      this.field = { terrain, layout, view: createField(this.scene, terrain, layout) };
      const floor = bench.group.getObjectByName('floor');
      if (floor) floor.visible = false;
      for (const cam of [this.camera, this.cameras.fpv, this.cameras.hd]) {
        cam.far = FIELD_RENDER.farM;
        cam.updateProjectionMatrix();
      }
    } else if (params.background) env.setBackground(params.background);

    this.drone = drone;
    this.scene.add(drone.root);
    drone.onGroundOffsetChange = (offset) => (drone.root.position.y = this.padTopY + offset);
    drone.root.position.y = this.padTopY + drone.groundOffset;
    drone.setSpinArrowsVisible(params.spinArrows);
    if (params.rpm !== null) this.rpmOverride = [params.rpm, params.rpm, params.rpm, params.rpm];

    const center = new Box3().setFromObject(drone.body).getCenter(new Vector3());
    this.controls.target.copy(center);
    this.controls.update();
    aimKeyLight(this.key, center);

    this.cameras.attach(drone);
    this.applySettings();
    if (params.camera) this.cameras.setMode(params.camera, true);
    if (params.feed) this.cameras.setFeed(params.feed);

    // Compile the translucent prop variants and every camera look now, not mid-flight.
    drone.warmUp();
    this.post.warmUp();
    drone.update(0);
    exposeDebug(this);
    if (params.flight) void this.loadFlight();
  }

  /**
   * Rapier (WASM) loads after the first frame so it never delays startup. Until it's ready the
   * bench model drives the props; then the flight sim takes over motors, pack and body.
   */
  private async loadFlight(): Promise<void> {
    const params = readParams();
    try {
      const [{ default: RAPIER }, { FlightSim }] = await Promise.all([
        import('@dimforge/rapier3d-deterministic-compat'),
        import('../sim/flight/FlightSim'),
      ]);
      await RAPIER.init();
      const base = AIRFRAMES[params.airframe ?? 'longrange7'];
      const sim = new FlightSim({
        rapier: RAPIER,
        airframe: withPayload(base, base.id === 'longrange7_payload' || this.drone.payload.visible),
        wind: params.wind ?? WIND.default,
        groundY: this.padTopY,
        field: this.field
          ? { terrain: this.field.terrain, layout: this.field.layout, padTopY: this.padTopY }
          : undefined,
      });
      if (sim.airframe.payload !== this.drone.payload.visible) this.drone.setPayloadVisible(sim.airframe.payload);
      this.powertrain.attachFlight(sim);
      this.flight = sim;
      this.applyFcSettings();
      this.lastDronePos.copy(this.drone.root.position);
    } catch (err) {
      console.warn('Flight physics unavailable, staying on the bench:', err);
    }
  }

  /** Payload toggle: the canister, and the matching long-range preset in flight (PRD §2.1). */
  setPayload(visible: boolean): void {
    this.drone.setPayloadVisible(visible);
    if (this.flight) this.flight.setAirframe(withPayload(this.flight.airframe, visible));
  }

  /** R / D-pad down: disarm and put the drone back on the launch pad. */
  resetDrone(): void {
    if (this.powertrain.power.armed) this.powertrain.disarm();
    this.flight?.reset();
  }

  /** Place the model from the flight sim's interpolated pose; the orbit view follows it. */
  private placeDrone(): void {
    if (!this.flight) return;
    const p = this.flight.interpolated();
    const root = this.drone.root;
    root.position.set(p.position.x, p.position.y, p.position.z);
    root.quaternion.set(p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w);
    if (this.followDrone) {
      const d = this.v.copy(root.position).sub(this.lastDronePos);
      this.camera.position.add(d);
      this.controls.target.add(d);
    }
    this.lastDronePos.copy(root.position);
    // The key light's tight shadow frustum travels with the drone.
    aimKeyLight(this.key, root.position);
  }

  /** Push the current settings into the live objects (config-level values are applied too). */
  applySettings(): void {
    const s = this.settings;
    applyConfigSettings(s);
    if (this.drone && this.drone.payload.visible !== s.payload) this.setPayload(s.payload);
    this.cameras.setFeed(s.feed);
    this.cameras.setUptilt(s.uptiltDeg);
    this.cameras.jello = s.jello;
    this.cameras.whipPan = s.whipPan;
    this.audio.setVolume(s.volume);
    this.input.throttleSource = s.throttleSource;
    this.input.throttleHold = s.throttleHold;
    this.input.haptics.enabled = s.rumble;
    this.applyFcSettings();
    // A ?quality= URL override (tests, screenshots) wins over the saved preset.
    if (!readParams().quality) this.quality.force(s.quality === 'auto' ? null : s.quality);
  }

  /** Flight controller settings (mode, rates, PIDs, sensors) onto the live FC. */
  private applyFcSettings(): void {
    const fc = this.flight?.fc;
    if (!fc) return;
    const s = this.settings;
    fc.mode = s.flightMode;
    fc.idealSensors = s.idealSensors;
    fc.ratesModel = s.ratesModel;
    fc.rates = { roll: { ...s.ratesRP }, pitch: { ...s.ratesRP }, yaw: { ...s.ratesYaw } };
    const rp = fromBf(s.pidRP);
    fc.gains = { roll: { ...rp }, pitch: { ...rp }, yaw: fromBf(s.pidYaw) };
  }

  /** Q / L2: Acro → Angle → Horizon. */
  cycleFlightMode(): void {
    const order: FlightMode[] = ['acro', 'angle', 'horizon'];
    const next = order[(order.indexOf(this.settings.flightMode) + 1) % order.length];
    this.remember({ flightMode: next });
    this.applyFcSettings();
    this.toast.show(`Flight mode: <b>${next.toUpperCase()}</b>`, 1400);
  }

  /** Mirror a change made outside the panel (keys, pad) into the saved settings. */
  private remember(p: Partial<Settings>): void {
    this.settingsPanel.patch(p);
    saveSettings(this.settings);
  }

  toggleMotorPanel(open = !this.motorPanel.open): void {
    if (open) this.settingsPanel.setOpen(false);
    this.motorPanel.setOpen(open);
  }

  toggleSettings(open = !this.settingsPanel.open): void {
    if (open) this.motorPanel.setOpen(false);
    this.settingsPanel.setOpen(open);
  }

  applyPreset(preset: QualityPreset): void {
    this.quality.preset = preset;
    const q = QUALITY[preset];
    setShadowMapSize(this.key, q.shadowMapSize);
    this.post.build(q);
    this.post.warmUp();
    this.resize();
  }

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    const dpr = Math.min(window.devicePixelRatio, QUALITY[this.quality.preset].maxPixelRatio);
    this.renderer.setPixelRatio(dpr * this.quality.scale);
    this.renderer.setSize(w, h);
    this.cameras.resize(w, h);
    this.osd.resize(w, h);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer.reset();
    void this.renderer.setAnimationLoop(() => this.frame());
    this.audio.resume();
  }

  /** Hidden tab: stop rendering and the simulation, and silence the (frozen) motors. */
  stop(): void {
    this.running = false;
    void this.renderer.setAnimationLoop(null);
    this.audio.pause();
  }

  /** Advance the frozen simulation by dt on the next frame. */
  step(dt: number): void {
    this.pendingStep += dt;
  }

  private frame(): void {
    this.timer.update();
    // Clamp both ways: long gaps (tab switch) and clock-base mismatches on the first frame.
    const dt = Math.min(Math.max(this.timer.getDelta(), 0), RENDER.maxFrameDtS);
    this.quality.update(dt);
    this.controls.update(dt);

    const simDt = this.simFrozen ? this.pendingStep : dt;
    // A frozen clock is stepped offline in chunks larger than a frame; don't cap those.
    if (this.flight) this.flight.maxStepsPerFrame = this.simFrozen ? Infinity : PHYSICS.maxStepsPerFrame;
    this.pendingStep = 0;
    const pt = this.powertrain;
    const controls = this.input.poll(dt);
    this.controlState = controls;
    for (const a of controls.actions) {
      if (a === 'plugToggle') pt.togglePlug();
      else if ((a === 'armToggle' || a === 'arm') && !pt.power.armed && pt.motorTest.enabled)
        this.toast.show('Motor test is on: close it to arm', 2000);
      else if (a === 'armToggle') pt.toggleArm();
      else if (a === 'arm') {
        if (!pt.power.armed) pt.arm();
      } else if (a === 'disarm') {
        if (pt.power.armed) pt.disarm();
      } else if (a === 'kill') pt.kill();
      else if (a === 'beaconToggle') pt.toggleBeacon();
      else if (a === 'payloadToggle') {
        this.setPayload(!this.drone.payload.visible);
        this.remember({ payload: this.drone.payload.visible });
      } else if (a === 'cameraCycle') this.cameras.cycle();
      else if (a === 'feedCycle') this.cycleFeed();
      else if (a === 'hideUi') this.setUiHidden(!this.uiHidden);
      else if (a === 'fullscreen') toggleFullscreen();
      else if (a === 'motorTest') this.toggleMotorPanel();
      else if (a === 'settings') this.toggleSettings();
      else if (a === 'reset') this.resetDrone();
      else if (a === 'modeCycle') this.cycleFlightMode();
      else if (a === 'turtleToggle') {
        pt.toggleTurtle();
        this.toast.show(
          pt.turtleSwitch
            ? 'Turtle mode <b>ON</b>: arm while upside down, then push the stick to the side to lift'
            : 'Turtle mode off',
          2400,
        );
      }
    }
    if (controls.kill && pt.power.armed) pt.kill();
    pt.throttle = this.throttleOverride ?? controls.throttle;
    pt.sticks = this.sticksOverride ?? { roll: controls.roll, pitch: controls.pitch, yaw: controls.yaw };
    pt.motorTest.enabled = this.motorPanel.open && this.motorPanel.safety;
    for (let i = 0; i < 4; i++) pt.motorTest.values[i] = this.motorPanel.values[i];
    this.lastEvents = pt.update(simDt);
    for (const e of this.lastEvents)
      if (e.type === 'armRefused') this.toast.show(armBlockedMessage(e.reason, controls.device));
    this.updateHaptics(controls);
    if (pt.turtleDone) this.toast.show('Upright again: turtle off, <b>arm to fly</b>', 2400);

    this.placeDrone();
    const rpms = this.rpmOverride ?? pt.rpms;
    this.drone.setRpm(rpms);
    this.drone.update(simDt, this.simFrozen ? PROP_BLEND.nominalFrameDtS : dt);
    this.updateLeds();
    this.cameras.update(dt, { fpvSignal: pt.power.powered, vibration: this.drone.vibrationIntensity });
    if (this.field) {
      const w = this.flight?.wind.velocity;
      this.windV.set(w?.x ?? 0, w?.y ?? 0, w?.z ?? 0);
      this.field.view.update(this.cameras.renderCamera.position, this.windV);
    }
    this.audio.update(this.audioFrame(simDt, rpms));
    this.prevRpms = [...rpms];
    if (this.lastEvents.some((e) => e.type === 'plugged')) this.armedTimeS = 0;
    if (pt.power.armed) this.armedTimeS += simDt;
    this.recTimeS += dt;
    this.drawOsd();
    this.inputViz.visible = !this.uiHidden && this.cameras.mode === 'orbit';
    this.inputViz.update(controls, pt.power.armed, this.input.uncalibratedRadios.length > 0);
    this.updatePanels(dt, rpms, controls);
    if (!this.renderPaused) this.post.render();
  }

  private updatePanels(dt: number, rpms: readonly number[], controls: ControlState): void {
    if (dt > 0) this.fps += (1 / dt - this.fps) * Math.min(1, dt * 2);
    const pt = this.powertrain;
    const p = pt.power;
    const cam =
      this.cameras.mode === 'fpv' ? `FPV ${this.cameras.feed.toUpperCase()}` : this.cameras.mode.toUpperCase();
    this.hud.update({
      state: p.state,
      testing: pt.testing,
      voltage: pt.battery.voltage,
      cellVoltage: pt.battery.cellVoltage,
      usedMah: pt.battery.usedMah,
      soc: pt.battery.soc,
      lowBattery: p.powered && pt.battery.lowWarning,
      rpms,
      camera: cam,
      device: controls.deviceName,
      fps: this.settings.showFps ? Math.round(this.fps) : null,
    });
    const status: MotorTestStatus = !p.powered
      ? 'unpowered'
      : p.state === 'BOOTING'
        ? 'booting'
        : p.armed
          ? 'armed'
          : 'ready';
    this.motorPanel.update(status, rpms);
  }

  setUiHidden(hidden: boolean): void {
    this.uiHidden = hidden;
    document.body.classList.toggle('pw-hide-ui', hidden);
  }

  /** Rumble on the active pad: weak motor follows load, strong pulses on beeps and arming. */
  private updateHaptics(controls: ControlState): void {
    const now = performance.now();
    const h = this.input.haptics;
    for (const e of this.lastEvents) {
      if (e.type === 'escPowerOnTones' || e.type === 'escSignalTones') h.pulse(now, 420);
      else if (e.type === 'armed' || e.type === 'disarmed' || e.type === 'armRefused') h.pulse(now);
    }
    const rpms = this.powertrain.rpms;
    const load = Math.sqrt(rpms.reduce((s, r) => s + r, 0) / rpms.length / DRONE.rpmMax);
    h.update(controls.device === 'gamepad' ? this.input.activePad : null, now, load);
  }

  /** Open the calibration wizard for the first radio that needs it (or the active radio). */
  calibrateRadio(): void {
    const active = this.input.pads.get(this.input.activeIndex);
    const radio = this.input.uncalibratedRadios[0] ?? (active instanceof RadioInput ? active : null);
    if (!radio) return this.toast.show('No RC radio connected', 1800);
    new CalibrationWizard(
      radio.id,
      () => radio.last,
      (cal) => {
        if (!cal) return;
        radio.calibration = cal;
        calibrationStore.save(cal);
        this.toast.show(`<b>${radio.name}</b> calibrated`, 2000);
      },
    );
  }

  /** V: analog / digital. Outside FPV it cuts straight to the FPV view in the new style. */
  cycleFeed(): void {
    this.cameras.cycleFeed();
    this.remember({ feed: this.cameras.feed });
    if (this.cameras.mode !== 'fpv') this.cameras.setMode('fpv');
    this.toast.show(`FPV feed: <b>${this.cameras.feed === 'analog' ? 'Analog' : 'Digital HD'}</b>`, 1400);
  }

  private drawOsd(): void {
    const pt = this.powertrain;
    const p = pt.power;
    let warning: string | null = null;
    if (p.powered) {
      if (pt.turtleSwitch) warning = 'CRASH FLIP';
      else if (p.warning === 'THROTTLE') warning = 'THROTTLE';
      else if (p.warning === 'ANGLE') warning = 'ANGLE';
      else if (p.state === 'BOOTING') warning = 'BOOTING';
      else if (pt.battery.lowWarning) warning = 'LOW BATTERY';
      else if (p.beacon) warning = 'BEACON ON';
    }
    this.osd.draw(
      {
        mode: this.cameras.mode,
        feed: this.cameras.feed,
        powered: p.powered,
        armed: p.armed,
        flightMode: this.flight
          ? ({ acro: 'ACRO', angle: 'ANGL', horizon: 'HOR' } as const)[this.settings.flightMode]
          : 'ACRO',
        voltage: pt.battery.voltage,
        cellVoltage: pt.battery.cellVoltage,
        usedMah: pt.battery.usedMah,
        armedTimeS: this.armedTimeS,
        throttle: pt.throttle,
        warning,
        recTimeS: this.recTimeS,
        fade: this.cameras.fade,
        time: performance.now() / 1000,
      },
      this.cameras.videoBox,
    );
  }

  /** FC LED: solid when powered, blinking when armed. VTX LED: red while booting, then green. */
  private updateLeds(): void {
    const s = this.powertrain.power.state;
    const leds = this.drone.leds;
    leds.setFc(s === 'OFF' ? 'off' : this.powertrain.power.armed ? 'blink' : 'solid');
    leds.setVtx(s === 'OFF' ? 'off' : s === 'BOOTING' ? 'red' : 'green');
  }

  private world(local: Vec3): Vec3 {
    const w = this.drone.body.localToWorld(this.v.set(...local));
    return [w.x, w.y, w.z];
  }

  private audioFrame(dt: number, rpms: readonly number[]): AudioFrame {
    const pt = this.powertrain;
    const rates = this.rpmOverride ? rpms.map((r, i) => (dt > 0 ? (r - this.prevRpms[i]) / dt : 0)) : pt.rpmRates;
    const cam = this.cameras.renderCamera;
    const fwd = cam.getWorldDirection(new Vector3());
    const up = new Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    return {
      dt,
      rpms,
      rpmRates: rates,
      driven: pt.driven,
      events: this.lastEvents,
      beacon: pt.power.beacon,
      lowBattery: pt.power.powered && pt.battery.lowWarning,
      rotorPositions: this.drone.rotors.map((r) => {
        const p = r.pivot.getWorldPosition(new Vector3());
        return [p.x, p.y, p.z] as const;
      }),
      framePosition: this.world(LEDS.fc.position),
      listener: {
        position: [cam.position.x, cam.position.y, cam.position.z],
        forward: [fwd.x, fwd.y, fwd.z],
        up: [up.x, up.y, up.z],
      },
      cameraMode: this.cameras.mode === 'orbit' ? 'orbit' : 'fpv',
      distance: this.cameras.mode === 'orbit' ? cam.position.distanceTo(this.controls.target) : 0,
    };
  }

  get backend(): 'webgpu' | 'webgl2' {
    return (this.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  }
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}
