import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Document } from '../model';

export interface SolidViewportProps {
  document: Document | null;
  selected: string;
  onSelect: (id: string) => void;
}

/** Visual approximation only: Three.js extrusion is NOT an OCCT/B-rep result. */
export function SolidViewport({ document, selected, onSelect }: SolidViewportProps) {
  const host = useRef<HTMLDivElement>(null);
  const meshGroup = useRef<THREE.Group | null>(null);
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
    renderer.domElement.setAttribute('aria-label', '3D preview viewport, orbit with pointer drag and zoom with mouse wheel');
    renderer.domElement.setAttribute('role', 'img');
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 35;
    controls.maxDistance = 800;
    controls.target.set(0, 4, 0);
    controls.update();

    const ambient = new THREE.HemisphereLight('#d5e7ff', '#152538', 3.2);
    scene.add(ambient);
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
    let frame = 0;
    let alive = true;
    const draw = () => {
      if (!alive) return;
      controls.update();
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
      renderer.dispose();
      renderer.domElement.remove();
      meshGroup.current = null;
    };
  }, []);

  useEffect(() => {
    const group = meshGroup.current;
    if (!group) return;
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
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 28), new THREE.LineBasicMaterial({ color: '#c4e2ee', transparent: true, opacity: 0.65 }));
    group.add(edges);
    const footprint = Math.max(width, depth);
    group.scale.setScalar(footprint > 180 ? 180 / footprint : 1);
  }, [document, selected]);

  return <div className="viewport-canvas" ref={host} data-testid="solid-viewport" />;
}
