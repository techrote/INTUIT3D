import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Document } from '../model';
import {
  nudgeThickness, projectThicknessAxis, proposeThicknessDrag,
  type ScreenPoint, type ThicknessDrag,
} from '../thicknessDrag';

export interface SolidViewportProps {
  document: Document | null;
  selected: string;
  onSelect: (id: string) => void;
  onChange: (value: number) => void;
  onGestureStart: () => void;
  onGesturePreview: (value: number) => void;
  onGestureFinish: () => void;
  onGestureCancel: () => void;
  canEdit: boolean;
}

type ActiveDrag = ThicknessDrag & { readonly pointerId: number };

interface Gizmo {
  readonly knob: THREE.Mesh;
  readonly stem: THREE.Line;
  readonly camera: THREE.PerspectiveCamera;
  scale: number;
  visible: boolean;
}

/**
 * Polygonal Three.js preview, not an OCCT B-rep. The 3D direct-edit knob
 * proposes a thickness scalar only; no face identities or exact geometry are
 * inferred from rendered triangles.
 */
export function SolidViewport({
  document, selected, onSelect, onChange, onGestureStart, onGesturePreview,
  onGestureFinish, onGestureCancel, canEdit,
}: SolidViewportProps) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const meshGroup = useRef<THREE.Group | null>(null);
  const gizmo = useRef<Gizmo | null>(null);
  const axis = useRef<ScreenPoint | null>(null);
  const drag = useRef<ActiveDrag | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#121b29');
    const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 2500);
    camera.position.set(180, 155, 180);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', '3D polygonal preview: orbit, pan, zoom, select; thickness gizmo is preview only');
    renderer.domElement.setAttribute('role', 'img');
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 35;
    controls.maxDistance = 800;
    controls.target.set(0, 4, 0);
    controls.update();

    scene.add(new THREE.HemisphereLight('#d5e7ff', '#152538', 3.2));
    const sun = new THREE.DirectionalLight('#eaf4ff', 2.1);
    sun.position.set(110, 220, 150);
    scene.add(sun);
    const grid = new THREE.GridHelper(600, 30, '#334b64', '#203247');
    grid.position.y = -0.4;
    scene.add(grid);
    const axes = new THREE.AxesHelper(38);
    axes.position.set(-100, 0, -75);
    scene.add(axes);
    const group = new THREE.Group();
    scene.add(group);
    meshGroup.current = group;

    const knob = new THREE.Mesh(new THREE.SphereGeometry(4.2, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#ffe3a1', depthTest: false }));
    knob.renderOrder = 20;
    scene.add(knob);
    const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(), new THREE.Vector3(0, 1, 0),
    ]), new THREE.LineBasicMaterial({ color: '#ffe3a1', depthTest: false }));
    stem.renderOrder = 19;
    scene.add(stem);
    gizmo.current = { knob, stem, camera, scale: 1, visible: false };
    knob.visible = false;
    stem.visible = false;

    const resize = () => {
      const width = Math.max(1, el.clientWidth);
      const height = Math.max(1, el.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    const downHandler = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; };
    const upHandler = (event: PointerEvent) => {
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) { down = null; return; }
      down = null;
      const bounds = renderer.domElement.getBoundingClientRect();
      mouse.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
      raycaster.setFromCamera(mouse, camera);
      if (raycaster.intersectObjects(group.children, true).length) selectRef.current('extrude-plate');
    };
    renderer.domElement.addEventListener('pointerdown', downHandler);
    renderer.domElement.addEventListener('pointerup', upHandler);

    const projected = (point: THREE.Vector3): ScreenPoint => {
      const p = point.clone().project(camera);
      return { x: (p.x + 1) * el.clientWidth / 2, y: (1 - p.y) * el.clientHeight / 2 };
    };
    let frame = 0;
    let alive = true;
    const draw = () => {
      if (!alive) return;
      controls.update();
      camera.updateMatrixWorld();
      const current = gizmo.current;
      const button = handle.current;
      if (current?.visible && button) {
        const origin = current.knob.position.clone();
        const position = projected(origin);
        const span = 10;
        const raised = projected(origin.clone().add(new THREE.Vector3(0, span * current.scale, 0)));
        try {
          const projectedAxis = projectThicknessAxis(position, raised, span);
          // Freeze the sensitivity used by an active drag even if the viewport
          // is resized or another render arrives while its preview changes.
          if (!drag.current) axis.current = projectedAxis;
          button.style.left = position.x + 'px';
          button.style.top = position.y + 'px';
          button.style.visibility = 'visible';
        } catch {
          axis.current = null;
          button.style.visibility = 'hidden';
        }
      } else if (button) {
        axis.current = null;
        button.style.visibility = 'hidden';
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', downHandler);
      renderer.domElement.removeEventListener('pointerup', upHandler);
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((mat) => mat.dispose());
          else obj.material.dispose();
        }
      });
      knob.geometry.dispose();
      (knob.material as THREE.Material).dispose();
      stem.geometry.dispose();
      (stem.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
      meshGroup.current = null;
      gizmo.current = null;
      axis.current = null;
    };
  }, []);

  useEffect(() => {
    const abandon = () => {
      if (!drag.current) return;
      drag.current = null;
      axis.current = null;
      onGestureCancel();
    };
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') abandon(); };
    const onVisibility = () => { if (globalThis.document.hidden) abandon(); };
    window.addEventListener('blur', abandon);
    window.addEventListener('keydown', onEscape);
    globalThis.document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', abandon);
      window.removeEventListener('keydown', onEscape);
      globalThis.document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [onGestureCancel]);

  useEffect(() => {
    const group = meshGroup.current;
    const current = gizmo.current;
    if (!group || !current) return;
    while (group.children.length) {
      const obj = group.children[0]!;
      group.remove(obj);
      obj.traverse((item) => {
        if (item instanceof THREE.Mesh || item instanceof THREE.LineSegments) {
          item.geometry.dispose();
          if (Array.isArray(item.material)) item.material.forEach((mat) => mat.dispose());
          else item.material.dispose();
        }
      });
    }
    current.visible = false;
    current.knob.visible = false;
    current.stem.visible = false;
    if (!document) return;
    const { width, depth, thickness, holeDiameter, holeSpacing } = document.params;
    const outline = new THREE.Shape();
    outline.moveTo(-width / 2, -depth / 2);
    outline.lineTo(width / 2, -depth / 2);
    outline.lineTo(width / 2, depth / 2);
    outline.lineTo(-width / 2, depth / 2);
    outline.closePath();
    for (const x of [-holeSpacing / 2, holeSpacing / 2]) {
      const hole = new THREE.Path();
      hole.absarc(x, 0, holeDiameter / 2, 0, Math.PI * 2, true);
      outline.holes.push(hole);
    }
    const geometry = new THREE.ExtrudeGeometry(outline, {
      depth: thickness, steps: 1, bevelEnabled: false, curveSegments: 72,
    });
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({
      color: selected === 'extrude-plate' || selected === 'cut-holes' ? '#4bafc1' : '#628da6',
      metalness: 0.64, roughness: 0.28, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Unqualified polygonal preview — not an exact CAD body';
    group.add(mesh);
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 28),
      new THREE.LineBasicMaterial({ color: '#c4e2ee', transparent: true, opacity: 0.65 })));
    const footprint = Math.max(width, depth);
    const modelScale = footprint > 180 ? 180 / footprint : 1;
    group.scale.setScalar(modelScale);
    const x = (width / 2 + 14) * modelScale;
    const z = depth / 2 * modelScale;
    const height = thickness * modelScale;
    current.scale = modelScale;
    current.knob.position.set(x, height, z);
    current.stem.geometry.dispose();
    current.stem.geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0, z), new THREE.Vector3(x, height, z),
    ]);
    current.visible = true;
    current.knob.visible = true;
    current.stem.visible = true;
  }, [document, selected]);

  const begin = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !canEdit || !document || drag.current || !axis.current) return;
    const projectedAxis = axis.current;
    drag.current = {
      pointerId: event.pointerId, startClient: { x: event.clientX, y: event.clientY },
      initialMm: document.params.thickness, axisPixelsPerMm: projectedAxis,
    };
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onGestureStart();
    onSelect('extrude-plate');
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    try {
      onGesturePreview(proposeThicknessDrag(active, { x: event.clientX, y: event.clientY }, event.shiftKey ? 0.1 : 1));
    } catch {
      drag.current = null;
      onGestureCancel();
    }
  };
  const finish = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    drag.current = null;
    onGestureFinish();
  };
  const cancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    drag.current = null;
    onGestureCancel();
  };
  const keyEdit = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!canEdit || !document || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    onSelect('extrude-plate');
    onChange(nudgeThickness(document.params.thickness,
      event.key === 'ArrowUp' ? 'up' : 'down', event.shiftKey ? 0.1 : 1));
  };

  return (
    <div className="viewport-canvas solid-preview-canvas" ref={host} data-testid="solid-viewport">
      <button type="button" ref={handle} className="solid-thickness-handle"
        aria-label="3D preview thickness: drag along the vertical gizmo, Arrow Up or Down to edit, Shift for 0.1 mm; Escape cancels"
        title="Drag to adjust preview thickness · Shift 0.1 mm · Esc cancels"
        data-testid="solid-thickness-handle"
        tabIndex={canEdit ? 0 : -1} aria-disabled={!canEdit}
        onPointerDown={begin} onPointerMove={move} onPointerUp={finish}
        onPointerCancel={cancel} onLostPointerCapture={cancel}
        onKeyDown={keyEdit}
      ><span aria-hidden="true">↕</span></button>
    </div>
  );
}
