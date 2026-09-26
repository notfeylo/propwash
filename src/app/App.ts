import {
  AgXToneMapping,
  Box3,
  PCFShadowMap,
  PerspectiveCamera,
  Quaternion,
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
import { AUDIO } from '../config/audio';
import { DRONE, LEDS, MODEL_CREDIT, PROP_BLEND } from '../config/drone';
import { PHYSICS } from '../config/physics';
import { FIELD_RENDER } from '../config/field';
import { createField, type FieldView } from '../render/field';
import { buildFieldLayout, type FieldLayout } from '../world/fieldLayout';
import { Terrain } from '../world/terrain';
import type { FlightSim, FlightSimOptions, Rapier } from '../sim/flight/FlightSim';
import { isFeedView } from '../config/cameras';
import { BLACKBOX, REPLAY } from '../config/blackbox';
import { parseBlackboxCsv, toCsv } from '../sim/blackbox';
import { FlightRecorder, flyImportedLog, ReplayRun } from '../sim/recorder';
import type { FlightLabPanel, ImportResult } from '../ui/FlightLabPanel';
import { ReplayBar } from '../ui/ReplayBar';
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
  /** Flight recordings: checkpoint + op log + blackbox from each arm (Phase 2 §8.2). */
  recorder: FlightRecorder | null = null;
  /** A replay in progress: the resimulated flight, the playback time and speed. */
  replay: { run: ReplayRun; t: number; playing: boolean; speed: number } | null = null;
  readonly replayBar: ReplayBar;
  flightLab: FlightLabPanel | null = null;
  private flightOpts: FlightSimOptions | null = null;
  private rapier: Rapier | null = null;
  private video: { rec: MediaRecorder; chunks: Blob[] } | null = null;
  private target = { position: new Vector3(), quaternion: new Quaternion(), velocity: new Vector3() };
  private qb = new Quaternion();
  /** The flight test field (Phase 2 §5), built when flight is on. */
  field: { terrain: Terrain; layout: FieldLayout; view: FieldView } | null = null;
  private windV = new Vector3();
  private lastStrike = [false, false, false, false];
  private lastListener = new Vector3();
  private listenerVel = new Vector3();
  private tmpA = new Vector3();
  private tmpB = new Vector3();
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
      document.body.classList.toggle('pw-feed-view', isFeedView(mode));
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
    this.replayBar = new ReplayBar();
    this.replayBar.onToggle = () => this.toggleReplayPlay();
    this.replayBar.onSeek = (t) => this.seekReplay(t);
    this.replayBar.onSpeed = (v) => this.replay && (this.replay.speed = v);
    this.replayBar.onVideo = () => this.toggleVideo();
    this.replayBar.onExit = () => this.stopReplay();
    this.hud.onFlightLab = () => void this.toggleFlightLab();
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
      this.rapier = RAPIER;
      this.flightOpts = {
        rapier: RAPIER,
        airframe: withPayload(base, base.id === 'longrange7_payload' || this.drone.payload.visible),
        wind: params.wind ?? WIND.default,
        groundY: this.padTopY,
        field: this.field
          ? { terrain: this.field.terrain, layout: this.field.layout, padTopY: this.padTopY }
          : undefined,
      };
      const sim = new FlightSim(this.flightOpts);
      this.recorder = new FlightRecorder(sim);
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
    const s = this.flight.state;
    this.target.position.copy(root.position);
    this.target.quaternion.copy(root.quaternion);
    this.target.velocity.set(s.velocity.x, s.velocity.y, s.velocity.z);
    // The antenna feels the real motion: specific force (minus 1 g vertical) and the air stream.
    const inv = root.quaternion.clone().invert();
    const w = this.flight.wind.velocity;
    this.tmpA.set(s.acceleration.x, s.acceleration.y, s.acceleration.z).applyQuaternion(inv);
    this.tmpB.set(w.x - s.velocity.x, w.y - s.velocity.y, w.z - s.velocity.z).applyQuaternion(inv);
    this.drone.setBodyMotion(this.tmpA, this.tmpB);
  }

  /** Push the current settings into the live objects (config-level values are applied too). */
  applySettings(): void {
    const s = this.settings;
    applyConfigSettings(s);
    if (this.drone && this.drone.payload.visible !== s.payload) this.setPayload(s.payload);
    this.cameras.setFeed(s.feed);
    this.cameras.setUptilt(s.uptiltDeg);
    this.cameras.jello = s.jello;
    this.cameras.hdStabilization = s.hdStabilization;
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
  applyFcSettings(): void {
    if (!this.flight) return;
    const s = this.settings;
    const rp = fromBf(s.pidRP);
    this.flight.configureFc({
      mode: s.flightMode,
      idealSensors: s.idealSensors,
      ratesModel: s.ratesModel,
      rates: { roll: { ...s.ratesRP }, pitch: { ...s.ratesRP }, yaw: { ...s.ratesYaw } },
      gains: { roll: { ...rp }, pitch: { ...rp }, yaw: fromBf(s.pidYaw) },
    });
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
    const replaying = this.replay !== null;
    for (const a of controls.actions) {
      if (a === 'flightLab') void this.toggleFlightLab();
      else if (a === 'replay') {
        if (replaying) this.stopReplay();
        else this.startReplay();
      } else if (a === 'hdStabCycle') {
        const m = this.cameras.cycleHdStabilization();
        this.remember({ hdStabilization: m });
        this.toast.show(
          `HD stabilization: <b>${{ raw: 'Raw', smooth: 'Smooth', horizon: 'Horizon lock' }[m]}</b>`,
          1400,
        );
      } else if (replaying) {
        // In a replay the drone isn't yours: Space plays / pauses, the views still switch.
        if (a === 'armToggle') this.toggleReplayPlay();
        else if (a === 'cameraCycle') this.cameras.cycle();
        else if (a === 'feedCycle') this.cycleFeed();
        else if (a === 'hideUi') this.setUiHidden(!this.uiHidden);
        else if (a === 'fullscreen') toggleFullscreen();
        else if (a === 'settings') this.toggleSettings();
      } else if (a === 'plugToggle') pt.togglePlug();
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
      else if (a === 'landToggle') {
        if (!this.flight || !pt.power.armed) this.toast.show('Land mode needs the drone armed and flying', 2000);
        else
          this.toast.show(
            pt.toggleAutoland() ? '<b>LAND</b>: flying home to land (move the sticks to take over)' : 'Land mode off',
            2400,
          );
      } else if (a === 'turtleToggle') {
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
    // During a replay the live drone waits (disarmed) where it was.
    this.lastEvents = pt.update(replaying ? 0 : simDt);
    this.recorder?.update(replaying ? 0 : simDt, pt.power.armed);
    for (const e of this.lastEvents)
      if (e.type === 'armRefused') this.toast.show(armBlockedMessage(e.reason, controls.device));
    this.updateHaptics(controls);
    if (pt.turtleDone) this.toast.show('Upright again: turtle off, <b>arm to fly</b>', 2400);
    if (pt.autolandDone) this.toast.show('Landed where it took off: <b>disarmed</b>', 2400);
    if (pt.autolandCancelled) this.toast.show('Land mode off: you have control', 2000);

    const rpms = this.replay ? this.replayFrame(dt) : (this.placeDrone(), this.rpmOverride ?? pt.rpms);
    this.drone.setRpm(rpms);
    this.drone.update(simDt, this.simFrozen ? PROP_BLEND.nominalFrameDtS : dt);
    this.updateLeds();
    const f = this.flight;
    this.cameras.update(dt, {
      fpvSignal: pt.power.powered || this.replay !== null,
      vibration: this.drone.vibrationIntensity,
      target: f ? this.target : undefined,
      castRay: f ? (o, d, max) => f.castRay(o, d, max) : undefined,
      groundAt: f ? (x, z) => f.groundAt(x, z) : undefined,
      padTopY: this.padTopY,
    });
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
    this.flightLab?.update(dt);
    this.inputViz.visible = !this.uiHidden && !isFeedView(this.cameras.mode) && !this.replay;
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
      if (pt.autoland && this.flight)
        warning = `LAND ${Math.round(this.flight.autoland.distance(this.flight.state, this.flight.home))}M`;
      else if (pt.turtleSwitch) warning = 'CRASH FLIP';
      else if (p.warning === 'THROTTLE') warning = 'THROTTLE';
      else if (p.warning === 'ANGLE') warning = 'ANGLE';
      else if (p.state === 'BOOTING') warning = 'BOOTING';
      else if (pt.battery.lowWarning) warning = 'LOW BATTERY';
      else if (p.beacon) warning = 'BEACON ON';
    }
    const rb = this.replaySample();
    this.osd.draw(
      {
        mode: this.cameras.mode,
        feed: this.cameras.feed,
        powered: p.powered || rb !== null,
        armed: rb ? rb.driven : p.armed,
        flightMode: !this.flight
          ? 'ACRO'
          : pt.autoland
            ? 'LAND'
            : ({ acro: 'ACRO', angle: 'ANGL', horizon: 'HOR' } as const)[this.settings.flightMode],
        voltage: rb ? rb.vbat : pt.battery.voltage,
        cellVoltage: rb ? rb.vbat / (this.flight?.airframe.pack.series ?? 6) : pt.battery.cellVoltage,
        usedMah: rb ? rb.mah : pt.battery.usedMah,
        armedTimeS: rb ? rb.t : this.armedTimeS,
        throttle: rb ? rb.throttle : pt.throttle,
        warning: rb ? 'REPLAY' : warning,
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
      cameraMode: isFeedView(this.cameras.mode) ? 'fpv' : 'orbit',
      distance: isFeedView(this.cameras.mode)
        ? 0
        : cam.position.distanceTo(this.cameras.mode === 'orbit' ? this.controls.target : this.target.position),
      ...this.flightAudio(dt, cam.position),
    };
  }

  /** Flight coupling for the audio frame (Phase 2 §6): air rush, prop wash, Doppler, hits. */
  private flightAudio(dt: number, listener: Vector3): Partial<AudioFrame> {
    const f = this.flight;
    if (!f) return {};
    if (this.replay) return this.replayAudio(dt, listener);
    const s = f.state;
    if (dt > 0) this.listenerVel.copy(listener).sub(this.lastListener).divideScalar(dt);
    this.lastListener.copy(listener);
    // Doppler: positive when the drone moves away from the listener.
    const toDrone = this.tmpA.set(s.position.x, s.position.y, s.position.z).sub(listener);
    const d = toDrone.length() || 1;
    const rel = this.tmpB.set(s.velocity.x, s.velocity.y, s.velocity.z).sub(this.listenerVel);
    const away = rel.dot(toDrone) / d;
    const D = AUDIO.doppler;
    const doppler = Math.min(1 + D.maxShift, Math.max(1 - D.maxShift, D.speedOfSoundMs / (D.speedOfSoundMs + away)));
    const strikes: number[] = [];
    s.propStrike.forEach((hit, i) => {
      if (hit && !this.lastStrike[i]) strikes.push(i);
      this.lastStrike[i] = hit;
    });
    return { airspeed: s.airspeed, propWash: s.propWash, doppler, impacts: f.drainImpacts(), propStrikes: strikes };
  }

  /** I: open / close the Flight Lab (its code and uPlot load on first use). */
  async toggleFlightLab(open = !this.flightLab?.open): Promise<void> {
    if (!this.flightLab) {
      const { FlightLabPanel } = await import('../ui/FlightLabPanel');
      this.flightLab = new FlightLabPanel({
        recording: () => this.recorder?.current ?? null,
        recordingActive: () => this.recorder?.active !== null && this.recorder?.active !== undefined,
        exportCsv: () => this.exportCsv(),
        startReplay: () => this.startReplay(),
        importLog: (file, drive) => this.importLog(file, drive),
      });
    }
    if (open) {
      this.settingsPanel.setOpen(false);
      this.motorPanel.setOpen(false);
    }
    this.flightLab.setOpen(open);
  }

  /** Download the newest recording as a blackbox_decode-style CSV. */
  exportCsv(): void {
    const r = this.recorder?.current;
    if (!r || r.blackbox.length === 0) return this.toast.show('Nothing recorded yet: arm and fly first', 2000);
    const stamp = r.startedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-');
    download(
      new Blob([toCsv(r.blackbox)], { type: 'text/csv' }),
      `propwash-${r.airframeId}-seed${r.seed}-${stamp}.csv`,
    );
  }

  /** Fly a Betaflight blackbox CSV through the current airframe (Flight Lab import, §8.3). */
  async importLog(file: File, drive: 'setpoint' | 'sticks'): Promise<ImportResult> {
    if (!this.rapier || !this.flight) throw new Error('Flight physics is still loading.');
    const log = parseBlackboxCsv(await file.text());
    // Give the panel a frame to show "flying…" before the (synchronous) run.
    await new Promise((r) => setTimeout(r, 30));
    const { FlightSim } = await import('../sim/flight/FlightSim');
    const sim = new FlightSim({ rapier: this.rapier, airframe: this.flight.airframe, wind: 'calm' });
    sim.configureFc({
      mode: 'acro',
      idealSensors: this.flight.fc.idealSensors,
      ratesModel: this.flight.fc.ratesModel,
      rates: this.flight.fc.rates,
      gains: this.flight.fc.gains,
    });
    try {
      const out = flyImportedLog(sim, log, drive === 'setpoint' && log.setpoint ? 'setpoint' : 'sticks');
      return { name: file.name, log, sim: out, airframe: sim.airframe.id, drive: log.setpoint ? drive : 'sticks' };
    } finally {
      sim.dispose();
    }
  }

  /** Y: replay the last flight (resimulated from its checkpoint and inputs). */
  startReplay(): void {
    const rec = this.recorder;
    if (!rec || !this.flightOpts || this.replay) return;
    if (this.powertrain.power.armed) return this.toast.show('Land and disarm to watch the replay', 2000);
    if (rec.active) rec.end();
    const r = rec.last;
    if (!r || r.blackbox.length < 10) return this.toast.show('No flight to replay yet: arm and fly first', 2000);
    void import('../sim/flight/FlightSim').then(({ FlightSim }) => {
      const run = new ReplayRun(new FlightSim(this.flightOpts!), r);
      this.replay = { run, t: 0, playing: true, speed: 1 };
      this.replayBar.show(true);
      this.cameras.snapFollowers();
      document.body.classList.add('pw-replay');
      this.toast.show('<b>REPLAY</b>: resimulated from the seed and your inputs', 2000);
    });
  }

  stopReplay(): void {
    if (!this.replay) return;
    if (this.video) this.toggleVideo();
    this.replay.run.dispose();
    this.replay = null;
    this.replayBar.show(false);
    this.cameras.snapFollowers();
    document.body.classList.remove('pw-replay');
  }

  toggleReplayPlay(): void {
    const r = this.replay;
    if (!r) return;
    if (r.t >= r.run.duration - 1e-3) r.t = 0;
    r.playing = !r.playing;
  }

  seekReplay(t: number): void {
    if (!this.replay) return;
    this.replay.t = Math.max(0, Math.min(t, this.replay.run.duration));
    this.cameras.snapFollowers();
  }

  /** The replay's recorded values at the playback time (OSD, audio), or null live. */
  private replaySample(): {
    t: number;
    i: number;
    a: number;
    vbat: number;
    mah: number;
    throttle: number;
    driven: boolean;
  } | null {
    const r = this.replay;
    if (!r) return null;
    const b = r.run.blackbox;
    if (b.length < 2) return null;
    const f = Math.min(r.t * b.rateHz, b.length - 1.001);
    const i = Math.floor(f);
    return {
      t: r.t,
      i,
      a: f - i,
      vbat: b.at(i, 'vbat'),
      mah: b.at(i, 'mah'),
      throttle: b.at(i, 'rc.throttle'),
      driven: [0, 1, 2, 3].some((m) => b.at(i, `motor.${m}` as 'motor.0') > 0),
    };
  }

  /** A replay frame: resimulate ahead, advance playback, pose the drone; returns the RPMs. */
  private replayFrame(dt: number): number[] {
    const r = this.replay!;
    r.run.run(REPLAY.budgetMs);
    r.run.verify();
    const dur = r.run.duration;
    // Playback never runs past what has been resimulated.
    if (r.playing) r.t = Math.min(r.t + dt * r.speed, dur, r.run.ready);
    if (r.t >= dur - 1e-3 && r.playing) {
      r.playing = false;
      if (this.video) this.toggleVideo();
    }
    const mm = r.run.mismatch;
    this.replayBar.update(r.t, r.run.ready, dur, r.playing, mm < 0 ? -1 : mm / BLACKBOX.rateHz, this.video !== null);
    const s = this.replaySample();
    const root = this.drone.root;
    if (!s) return [0, 0, 0, 0];
    const b = r.run.blackbox;
    const lerp = (ch: Parameters<typeof b.at>[1]) => b.at(s.i, ch) + (b.at(s.i + 1, ch) - b.at(s.i, ch)) * s.a;
    root.position.set(lerp('pos.x'), lerp('pos.y'), lerp('pos.z'));
    this.qb.set(b.at(s.i, 'quat.x'), b.at(s.i, 'quat.y'), b.at(s.i, 'quat.z'), b.at(s.i, 'quat.w'));
    root.quaternion
      .set(b.at(s.i + 1, 'quat.x'), b.at(s.i + 1, 'quat.y'), b.at(s.i + 1, 'quat.z'), b.at(s.i + 1, 'quat.w'))
      .normalize();
    root.quaternion.slerpQuaternions(this.qb.normalize(), root.quaternion.clone(), s.a);
    if (this.followDrone) {
      const d = this.v.copy(root.position).sub(this.lastDronePos);
      this.camera.position.add(d);
      this.controls.target.add(d);
    }
    this.lastDronePos.copy(root.position);
    aimKeyLight(this.key, root.position);
    this.target.position.copy(root.position);
    this.target.quaternion.copy(root.quaternion);
    this.target.velocity.set(lerp('vel.x'), lerp('vel.y'), lerp('vel.z'));
    return [0, 1, 2, 3].map((m) => lerp(`rpm.${m}` as 'rpm.0'));
  }

  /** Replay audio coupling: Doppler and air rush from the recorded motion. */
  private replayAudio(dt: number, listener: Vector3): Partial<AudioFrame> {
    if (dt > 0) this.listenerVel.copy(listener).sub(this.lastListener).divideScalar(dt);
    this.lastListener.copy(listener);
    const t = this.target;
    const toDrone = this.tmpA.copy(t.position).sub(listener);
    const d = toDrone.length() || 1;
    const away = this.tmpB.copy(t.velocity).sub(this.listenerVel).dot(toDrone) / d;
    const D = AUDIO.doppler;
    const doppler = Math.min(1 + D.maxShift, Math.max(1 - D.maxShift, D.speedOfSoundMs / (D.speedOfSoundMs + away)));
    return { airspeed: t.velocity.length(), propWash: 0, doppler, impacts: [], propStrikes: [] };
  }

  /** Record the canvas as a WebM while the replay plays (the OSD overlay isn't in it). */
  toggleVideo(): void {
    if (this.video) {
      this.video.rec.stop();
      return;
    }
    const canvas = this.renderer.domElement;
    if (!('captureStream' in canvas) || typeof MediaRecorder === 'undefined')
      return this.toast.show('This browser cannot record the canvas', 2000);
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    const rec = new MediaRecorder(
      canvas.captureStream(60),
      mime ? { mimeType: mime, videoBitsPerSecond: 12e6 } : undefined,
    );
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      this.video = null;
      download(new Blob(chunks, { type: 'video/webm' }), `propwash-replay-${this.cameras.mode}.webm`);
    };
    this.video = { rec, chunks };
    rec.start(250);
    if (this.replay) {
      if (this.replay.t >= this.replay.run.duration - 1e-3) this.replay.t = 0;
      this.replay.playing = true;
    }
  }

  get backend(): 'webgpu' | 'webgl2' {
    return (this.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  }
}

function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}
