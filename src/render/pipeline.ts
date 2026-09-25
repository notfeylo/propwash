import { type Camera, type Node, RenderPipeline, type Scene, type WebGPURenderer } from 'three/webgpu';
import {
  builtinAOContext,
  convertToTexture,
  mrt,
  normalView,
  output,
  pass,
  renderOutput,
  screenUV,
  velocity,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { POST, type QualitySettings } from '../config/render';
import { cameraLook, type LookKind, LookUniforms } from './cameraLook';

/**
 * Scene pass (MRT: color, velocity; depth) with GTAO from an opaque normal/depth prepass
 * applied to indirect light only → TRAA → Bloom → AgX tone map + sRGB → the active camera's
 * look (FPV analog/digital, HD, or plain orbit), which works in display space like a video feed.
 */
export class PostPipeline {
  readonly pipeline: RenderPipeline;
  view: LookKind = 'orbit';
  private views = new Map<LookKind, Node>();
  private disposables: { dispose(): void }[] = [];

  constructor(
    renderer: WebGPURenderer,
    private scene: Scene,
    private camera: Camera,
    readonly look: LookUniforms = new LookUniforms(),
  ) {
    this.pipeline = new RenderPipeline(renderer);
    this.pipeline.outputColorTransform = false; // tone map before the camera look
  }

  build(q: QualitySettings): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];

    const scenePass = pass(this.scene, this.camera);
    scenePass.setMRT(mrt({ output, velocity }));
    this.disposables.push(scenePass);

    if (q.ao) {
      // Transparent effects (prop blur, ghosts) stay out of the AO inputs.
      const prePass = pass(this.scene, this.camera);
      prePass.transparent = false;
      prePass.setMRT(mrt({ output: normalView }));
      const aoPass = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), this.camera);
      aoPass.resolutionScale = q.aoResolutionScale;
      aoPass.samples.value = q.aoSamples;
      aoPass.radius.value = POST.ao.radius;
      aoPass.thickness.value = POST.ao.thickness;
      aoPass.distanceExponent.value = POST.ao.distanceExponent;
      aoPass.scale.value = POST.ao.scale;
      aoPass.useTemporalFiltering = true; // TRAA resolves the per-frame noise rotation
      scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
      this.disposables.push(prePass, aoPass);
    }

    const aa = traa(
      scenePass.getTextureNode('output'),
      scenePass.getTextureNode('depth'),
      scenePass.getTextureNode('velocity'),
      this.camera,
    );
    this.disposables.push(aa);
    let out: Node = aa;
    if (q.bloom) {
      const glow = bloom(aa, POST.bloom.strength, POST.bloom.radius, POST.bloom.threshold);
      this.disposables.push(glow);
      out = aa.add(glow);
    }
    const ldr = convertToTexture(renderOutput(out));
    this.views.clear();
    for (const kind of ['orbit', 'analog', 'digital', 'hd'] as LookKind[])
      this.views.set(kind, cameraLook(ldr, this.look, kind));
    this.setView(this.view);
  }

  setView(kind: LookKind): void {
    this.view = kind;
    this.pipeline.outputNode = this.views.get(kind)!;
    this.pipeline.needsUpdate = true;
  }

  /** Render every view once so switching cameras never compiles shaders mid-flight. */
  warmUp(): void {
    const current = this.view;
    for (const kind of this.views.keys()) {
      this.setView(kind);
      this.pipeline.render();
    }
    this.setView(current);
  }

  render(): void {
    this.pipeline.render();
  }
}
