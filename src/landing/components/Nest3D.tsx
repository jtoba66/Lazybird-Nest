import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

const GlassFolder = () => {
    const groupRef = useRef<THREE.Group>(null);
    const frontPanelRef = useRef<THREE.Mesh>(null);

    useFrame((state) => {
        const t = state.clock.getElapsedTime();
        if (groupRef.current) {
            // Gentle float/tilt
            groupRef.current.rotation.y = Math.sin(t * 0.3) * 0.1 - 0.2; // Slight side view
            groupRef.current.rotation.z = Math.sin(t * 0.2) * 0.05;
        }
        if (frontPanelRef.current) {
            // Subtle "breathing" open/close
            frontPanelRef.current.rotation.x = 0.4 + Math.sin(t * 0.5) * 0.05;
        }
    });

    const GlassMaterial = {
        transmission: 0.95, // High transparency
        opacity: 1,
        roughness: 0.1, // Slight frost
        metalness: 0.2, // Steel tint
        thickness: 2,
        ior: 1.5,
        color: "#8DA9C4", // Brand Secondary (Muted Blue)
        clearcoat: 1,
    };

    const SteelMaterial = {
        color: "#5D7285", // Brand Primary (Deep Steel)
        roughness: 0.2,
        metalness: 0.8,
    };

    return (
        <group ref={groupRef} rotation={[0.2, 0.4, 0]}>

            {/* Back Panel - Muted Blue Glass */}
            <RoundedBox args={[4, 3, 0.2]} radius={0.2} smoothness={4} position={[0, 0, -0.2]}>
                <meshPhysicalMaterial {...GlassMaterial} />
            </RoundedBox>

            {/* Paper Document Inside */}
            <RoundedBox args={[3.2, 2.4, 0.05]} radius={0.05} smoothness={2} position={[0, 0.1, 0]} rotation={[0.05, 0, 0]}>
                <meshStandardMaterial color="#ffffff" roughness={0.4} />
            </RoundedBox>

            {/* Front Panel - Muted Blue Glass */}
            <group position={[0, -1.5, 0]}>
                <group ref={frontPanelRef} rotation={[0.4, 0, 0]}>
                    <RoundedBox args={[4, 3, 0.2]} radius={0.2} smoothness={4} position={[0, 1.5, 0]}>
                        <meshPhysicalMaterial {...GlassMaterial} />
                    </RoundedBox>
                    {/* Steel Accent Stripe on Front */}
                    <RoundedBox args={[1, 0.4, 0.22]} radius={0.05} smoothness={2} position={[1.2, 2.6, 0]}>
                        <meshStandardMaterial {...SteelMaterial} />
                    </RoundedBox>
                </group>
            </group>

            {/* Tab on Back Panel - Deep Steel */}
            <RoundedBox args={[1.5, 0.5, 0.2]} radius={0.1} smoothness={4} position={[-1.25, 1.5, -0.2]}>
                <meshStandardMaterial {...SteelMaterial} />
            </RoundedBox>

        </group>
    );
};

const Nest3D = () => {
    return (
        <div
            className="w-full h-full"
            role="img"
            aria-label="Interactive 3D visualization of a transparent glass folder representing secure, private storage."
        >
            <Canvas camera={{ position: [0, 0, 8], fov: 45 }}>
                {/* Environment & Lighting: Clean, Corporate, Steel */}
                <ambientLight intensity={1.5} />
                <directionalLight position={[5, 10, 10]} intensity={3} color="#ffffff" />
                <directionalLight position={[-5, -5, -10]} intensity={2} color="#8DA9C4" /> {/* Secondary fill */}

                {/* Soft White Backlight */}
                <pointLight position={[0, 0, -5]} intensity={3} color="#F0F4F8" />

                <Float speed={2} rotationIntensity={0.2} floatIntensity={0.5}>
                    <GlassFolder />
                </Float>
            </Canvas>
        </div>
    );
};

export default Nest3D;
