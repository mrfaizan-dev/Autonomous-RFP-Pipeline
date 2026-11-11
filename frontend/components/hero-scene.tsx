'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export default function HeroScene() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.setClearColor(0x111713, 0);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, host.clientWidth / host.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 8.5);

    const globeGeometry = new THREE.IcosahedronGeometry(2.05, 2);
    const globeMaterial = new THREE.MeshBasicMaterial({ color: 0x90b7a6, wireframe: true, transparent: true, opacity: 0.13 });
    const globe = new THREE.Mesh(globeGeometry, globeMaterial);
    globe.position.set(1.8, 0.2, -0.7);
    scene.add(globe);

    const ringGeometry = new THREE.TorusGeometry(2.5, 0.006, 4, 160);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xd7a75d, transparent: true, opacity: 0.34 });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.set(1.8, 0.2, -1.05);
    ring.rotation.set(0.62, 0.24, -0.22);
    scene.add(ring);

    const count = 520;
    const points = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const spread = 8.5;
      points[i * 3] = (Math.random() - 0.5) * spread + 1.3;
      points[i * 3 + 1] = (Math.random() - 0.5) * 5.8;
      points[i * 3 + 2] = (Math.random() - 0.5) * 4.2 - 1.2;
    }
    const pointsGeometry = new THREE.BufferGeometry();
    pointsGeometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
    const pointsMaterial = new THREE.PointsMaterial({ color: 0xc5d6ce, size: 0.018, transparent: true, opacity: 0.58, sizeAttenuation: true });
    const stars = new THREE.Points(pointsGeometry, pointsMaterial);
    scene.add(stars);

    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
    const onPointerMove = (event: PointerEvent) => {
      pointer.targetX = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 0.55;
      pointer.targetY = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 0.35;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    let animationId = 0;
    const animate = () => {
      pointer.x += (pointer.targetX - pointer.x) * 0.035;
      pointer.y += (pointer.targetY - pointer.y) * 0.035;
      if (!reduceMotion) {
        globe.rotation.y += 0.0009;
        globe.rotation.x += 0.00025;
        ring.rotation.z += 0.00045;
        stars.rotation.y += 0.00016;
      }
      globe.rotation.y += pointer.x * 0.0008;
      camera.position.x += (pointer.x * 0.38 - camera.position.x) * 0.025;
      camera.position.y += (-pointer.y * 0.28 - camera.position.y) * 0.025;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      if (!reduceMotion) animationId = window.requestAnimationFrame(animate);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      if (!host) return;
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (reduceMotion) renderer.render(scene, camera);
    });
    resizeObserver.observe(host);

    return () => {
      window.cancelAnimationFrame(animationId);
      window.removeEventListener('pointermove', onPointerMove);
      resizeObserver.disconnect();
      globeGeometry.dispose();
      globeMaterial.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      pointsGeometry.dispose();
      pointsMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className="hero-scene" aria-hidden="true" />;
}
