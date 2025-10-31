import * as THREE from './build/three.module.js';

import Stats from './jsm/libs/stats.module.js';

import { GLTFLoader } from './jsm/loaders/GLTFLoader.js';

import { Octree } from './jsm/math/Octree.js';
import { OctreeHelper } from './jsm/helpers/OctreeHelper.js';

import { Capsule } from './jsm/math/Capsule.js';

import { GUI } from './jsm/libs/lil-gui.module.min.js';

import { EffectComposer } from './jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './jsm/postprocessing/RenderPass.js';
import { GlitchPass } from './jsm/postprocessing/GlitchPass.js';

import { KTX2Loader } from './jsm/loaders/KTX2Loader.js';

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

if (isMobile) {
    const container = document.getElementById('container');
    container.style.display = 'none';  // hide your scene

    const mobileMsg = document.createElement('div');
    mobileMsg.style.position = 'fixed';
    mobileMsg.style.top = '0';
    mobileMsg.style.left = '0';
    mobileMsg.style.width = '100%';
    mobileMsg.style.height = '100%';
    mobileMsg.style.backgroundColor = '#111';
    mobileMsg.style.color = 'white';
    mobileMsg.style.fontFamily = 'monospace';
    mobileMsg.style.fontSize = '24px';
    mobileMsg.style.display = 'flex';
    mobileMsg.style.justifyContent = 'center';
    mobileMsg.style.alignItems = 'center';
    mobileMsg.style.textAlign = 'center';
    mobileMsg.innerText = "Sorry, this art gallery is not supported on mobile yet.\nPlease use a PC or laptop.";
    document.body.appendChild(mobileMsg);

    // Stop further initialization
    throw new Error("Mobile not supported");
}

const clock = new THREE.Clock();

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0x87ceeb ); // sky
// scene.fog = new THREE.Fog( 0xff0000, 10, 100 );

const camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 0.1, 1000 );
camera.rotation.order = 'YXZ';

// const fillLight1 = new THREE.HemisphereLight( 0xff0000, 0x440000, 1.5 ); // red
const fillLight1 = new THREE.HemisphereLight( 0xffffff, 0x440000, 1.5 ); // white
fillLight1.position.set( 2, 1, 1 );
scene.add( fillLight1 );

const directionalLight = new THREE.DirectionalLight( 0xffffff, 2.5 );
directionalLight.position.set( - 5, 25, - 1 );
directionalLight.castShadow = true;
directionalLight.shadow.camera.near = 0.01;
directionalLight.shadow.camera.far = 500;
directionalLight.shadow.camera.right = 30;
directionalLight.shadow.camera.left = - 30;
directionalLight.shadow.camera.top	= 30;
directionalLight.shadow.camera.bottom = - 30;
directionalLight.shadow.mapSize.width = 1024;
directionalLight.shadow.mapSize.height = 1024;
directionalLight.shadow.radius = 4;
directionalLight.shadow.bias = - 0.00006;
scene.add( directionalLight );

const container = document.getElementById( 'container' );

const renderer = new THREE.WebGLRenderer( { antialias: true } );
renderer.setPixelRatio( window.devicePixelRatio );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setAnimationLoop( animate );
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
container.appendChild( renderer.domElement );

const ktx2Loader = new KTX2Loader()
    .setTranscoderPath('./jsm/libs/basis/') // folder containing basis_transcoder.*
    .detectSupport(renderer);

// --- Post-processing setup ---
const composer = new EffectComposer(renderer);
// Normal render pass
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
// Glitch pass
const glitchPass = new GlitchPass();
glitchPass.goWild = false;   // subtle glitch
glitchPass.enabled = false;  // start disabled
composer.addPass(glitchPass);

const stats = new Stats();
stats.domElement.style.position = 'absolute';
stats.domElement.style.top = '0px';
container.appendChild( stats.domElement );

const GRAVITY = 30;

const NUM_SPHERES = 100;
const SPHERE_RADIUS = 0.2;

const STEPS_PER_FRAME = 5;

const sphereGeometry = new THREE.IcosahedronGeometry( SPHERE_RADIUS, 5 );
const sphereMaterial = new THREE.MeshLambertMaterial( { color: 0x12ffb0 } );

const spheres = [];
let sphereIdx = 0;

for ( let i = 0; i < NUM_SPHERES; i ++ ) {

    const sphere = new THREE.Mesh( sphereGeometry, sphereMaterial );
    sphere.castShadow = true;
    sphere.receiveShadow = true;

    scene.add( sphere );

    spheres.push( {
        mesh: sphere,
        collider: new THREE.Sphere( new THREE.Vector3( 0, - 100, 0 ), SPHERE_RADIUS ),
        velocity: new THREE.Vector3()
    } );

}

const worldOctree = new Octree();

const spawnHeight = 10; // bc floor is z=2, spawns above

const playerCollider = new Capsule( new THREE.Vector3( 0, spawnHeight , 0 ), new THREE.Vector3( 0, spawnHeight + 0.65, 0 ), 0.35 );

const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();

let playerOnFloor = false;
let mouseTime = 0;

// --- Interaction system ---
let currentInteraction = null;
let hallucinating = false;
let hallucinationStartTime = 0;
let hallucinationHue = 0; // store the current hue
const hallucinationDuration = 30; // seconds
const originalSkyColor = new THREE.Color(0x87ceeb); // store original sky color
const interactionDistancePainting = 10; // distance threshold for interacting (tweak this)
const interactionDistanceMushroom = 3; // distance threshold for interacting (tweak this)
const interactionMessage = document.createElement('div');
interactionMessage.style.position = 'absolute';
interactionMessage.style.bottom = '40px';
interactionMessage.style.width = '100%';
interactionMessage.style.textAlign = 'center';
interactionMessage.style.color = 'white';
interactionMessage.style.fontFamily = 'monospace';
interactionMessage.style.fontSize = '20px';
interactionMessage.style.textShadow = '0 0 10px black';
interactionMessage.style.display = 'none';
interactionMessage.innerText = "Press 'V' to view on Etsy";
document.body.appendChild(interactionMessage);

const keyStates = {};

const vector1 = new THREE.Vector3();
const vector2 = new THREE.Vector3();
const vector3 = new THREE.Vector3();

document.addEventListener( 'keydown', ( event ) => {
    keyStates[ event.code ] = true;
} );
document.addEventListener( 'keyup', ( event ) => {
    keyStates[ event.code ] = false;
} );
container.addEventListener( 'mousedown', () => {
    document.body.requestPointerLock();
    mouseTime = performance.now();
} );
document.addEventListener( 'mouseup', () => {
    if ( document.pointerLockElement !== null ) throwBall();
} );
document.body.addEventListener( 'mousemove', ( event ) => {
    if ( document.pointerLockElement === document.body ) {
        camera.rotation.y -= event.movementX / 500;
        camera.rotation.x -= event.movementY / 500;
    }
} );

window.addEventListener( 'resize', onWindowResize );
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( window.innerWidth, window.innerHeight );
}

document.addEventListener('keydown', (event) => {
    if (event.code === 'KeyB' && currentInteraction?.userData?.type === 'painting') {
        window.open(currentInteraction.userData.url, '_blank');
    }
    if (event.code === 'KeyE' && currentInteraction?.name.startsWith('mushroom')) {
        startHallucination();
    }
});

function throwBall() {
    const sphere = spheres[ sphereIdx ];
    camera.getWorldDirection( playerDirection );
    sphere.collider.center.copy( playerCollider.end ).addScaledVector( playerDirection, playerCollider.radius * 1.5 );
    // throw the ball with more force if we hold the button longer, and if we move forward
    const impulse = 15 + 30 * ( 1 - Math.exp( ( mouseTime - performance.now() ) * 0.001 ) );
    sphere.velocity.copy( playerDirection ).multiplyScalar( impulse );
    sphere.velocity.addScaledVector( playerVelocity, 2 );
    sphereIdx = ( sphereIdx + 1 ) % spheres.length;
}

function playerCollisions() {
    const result = worldOctree.capsuleIntersect( playerCollider );
    playerOnFloor = false;
    if ( result ) {
        playerOnFloor = result.normal.y > 0;
        if ( ! playerOnFloor ) {
            playerVelocity.addScaledVector( result.normal, - result.normal.dot( playerVelocity ) );
        }
        if ( result.depth >= 1e-10 ) {
            playerCollider.translate( result.normal.multiplyScalar( result.depth ) );
        }
    }
}

function updatePlayer( deltaTime ) {
    let damping = Math.exp( - 4 * deltaTime ) - 1;
    if ( ! playerOnFloor ) {
        playerVelocity.y -= GRAVITY * deltaTime;
        // small air resistance
        damping *= 0.1;
    }
    playerVelocity.addScaledVector( playerVelocity, damping );
    const deltaPosition = playerVelocity.clone().multiplyScalar( deltaTime );
    playerCollider.translate( deltaPosition );
    playerCollisions();
    camera.position.copy( playerCollider.end );
}

function playerSphereCollision( sphere ) {
    const center = vector1.addVectors( playerCollider.start, playerCollider.end ).multiplyScalar( 0.5 );
    const sphere_center = sphere.collider.center;
    const r = playerCollider.radius + sphere.collider.radius;
    const r2 = r * r;
    // approximation: player = 3 spheres
    for ( const point of [ playerCollider.start, playerCollider.end, center ] ) {
        const d2 = point.distanceToSquared( sphere_center );
        if ( d2 < r2 ) {
            const normal = vector1.subVectors( point, sphere_center ).normalize();
            const v1 = vector2.copy( normal ).multiplyScalar( normal.dot( playerVelocity ) );
            const v2 = vector3.copy( normal ).multiplyScalar( normal.dot( sphere.velocity ) );
            playerVelocity.add( v2 ).sub( v1 );
            sphere.velocity.add( v1 ).sub( v2 );
            const d = ( r - Math.sqrt( d2 ) ) / 2;
            sphere_center.addScaledVector( normal, - d );
        }
    }
}

function spheresCollisions() {
    for ( let i = 0, length = spheres.length; i < length; i ++ ) {
        const s1 = spheres[ i ];
        for ( let j = i + 1; j < length; j ++ ) {
            const s2 = spheres[ j ];
            const d2 = s1.collider.center.distanceToSquared( s2.collider.center );
            const r = s1.collider.radius + s2.collider.radius;
            const r2 = r * r;
            if ( d2 < r2 ) {
                const normal = vector1.subVectors( s1.collider.center, s2.collider.center ).normalize();
                const v1 = vector2.copy( normal ).multiplyScalar( normal.dot( s1.velocity ) );
                const v2 = vector3.copy( normal ).multiplyScalar( normal.dot( s2.velocity ) );
                s1.velocity.add( v2 ).sub( v1 );
                s2.velocity.add( v1 ).sub( v2 );
                const d = ( r - Math.sqrt( d2 ) ) / 2;
                s1.collider.center.addScaledVector( normal, d );
                s2.collider.center.addScaledVector( normal, - d );
            }
        }
    }
}

function updateSpheres( deltaTime ) {
    spheres.forEach( sphere => {
        sphere.collider.center.addScaledVector( sphere.velocity, deltaTime );
        const result = worldOctree.sphereIntersect( sphere.collider );
        if ( result ) {
            sphere.velocity.addScaledVector( result.normal, - result.normal.dot( sphere.velocity ) * 1.5 );
            sphere.collider.center.add( result.normal.multiplyScalar( result.depth ) );
        } else {
            sphere.velocity.y -= GRAVITY * deltaTime;
        }
        const damping = Math.exp( - 1.5 * deltaTime ) - 1;
        sphere.velocity.addScaledVector( sphere.velocity, damping );
        playerSphereCollision( sphere );
    } );

    spheresCollisions();
    for ( const sphere of spheres ) {
        sphere.mesh.position.copy( sphere.collider.center );
    }
}

function getForwardVector() {
    camera.getWorldDirection( playerDirection );
    playerDirection.y = 0;
    playerDirection.normalize();
    return playerDirection;
}

function getSideVector() {
    camera.getWorldDirection( playerDirection );
    playerDirection.y = 0;
    playerDirection.normalize();
    playerDirection.cross( camera.up );
    return playerDirection;
}

function controls( deltaTime ) {
    // gives a bit of air control
    const speedDelta = deltaTime * ( playerOnFloor ? 50 : 16 ); // run speed : air speed
    if ( keyStates[ 'KeyW' ] ) {
        playerVelocity.add( getForwardVector().multiplyScalar( speedDelta ) );
    }
    if ( keyStates[ 'KeyS' ] ) {
        playerVelocity.add( getForwardVector().multiplyScalar( - speedDelta ) );
    }
    if ( keyStates[ 'KeyA' ] ) {
        playerVelocity.add( getSideVector().multiplyScalar( - speedDelta ) );
    }
    if ( keyStates[ 'KeyD' ] ) {
        playerVelocity.add( getSideVector().multiplyScalar( speedDelta ) );
    }
    if ( playerOnFloor ) {
        if ( keyStates[ 'Space' ] ) {
            playerVelocity.y = 25; // jump speed
        }
    }
}


const loader = new GLTFLoader().setPath( './models/gltf/' );
loader.setKTX2Loader(ktx2Loader);
loader.load( 'GallerySpace_mini.glb', 
    ( gltf ) => {
    scene.add( gltf.scene );
    worldOctree.fromGraphNode( gltf.scene );
    document.getElementById('loadingScreen').style.display = 'none'; // Remove loading screen when done
    gltf.scene.traverse( child => {
        if ( child.isMesh ) {
            child.castShadow = true;
            child.receiveShadow = true;
            if ( child.material.map ) {
                child.material.map.anisotropy = 4;
            }
        }
        //Tag paintings with URLs manually
        if (child.name.startsWith('painting_')) {
            switch (child.name) {
                case 'painting_hubris':
                    child.userData = { type: 'painting', url: 'https://www.etsy.com/listing/4394876033/hubris' };
                    break;
                case 'painting_impulse':
                    child.userData = { type: 'painting', url: 'https://www.etsy.com/listing/4394851004/impulse' };
                    break;
                case 'painting_persona':
                    child.userData = { type: 'painting', url: 'https://www.etsy.com/listing/4394970767/persona' };
                    break;
                case 'painting_sparrow':
                    child.userData = { type: 'painting', url: 'https://www.etsy.com/listing/4394969920/morning-sparrow' };
                    break;
                default:
                    child.userData = { type: 'painting', url: '#' }; // default
            }
            console.log(`Found painting: ${child.name}`, child.userData);
        }
    } );

    const helper = new OctreeHelper( worldOctree );
    helper.visible = false;
    scene.add( helper );

    const gui = new GUI( { width: 200 } );
    gui.add( { debug: false }, 'debug' )
        .onChange( function ( value ) {

            helper.visible = value;

        } );
    } );

function teleportPlayerIfOob() {
    if ( camera.position.y <= - 25 ) {
        playerCollider.start.set( 0, spawnHeight , 0 );
        playerCollider.end.set( 0, spawnHeight + 0.65 , 0 );
        playerCollider.radius = 0.35;
        camera.position.copy( playerCollider.end );
        camera.rotation.set( 0, 0, 0 );
    }
}

function checkInteractions() {
    currentInteraction = null;
    scene.traverse(child => {
        if (child.userData?.type === 'painting') {
            const distance = child.position.distanceTo(camera.position);
            if (distance < interactionDistancePainting) {
                currentInteraction = child;
            }
        } else if (child.name.startsWith('mushroom')) {
            const distance = child.position.distanceTo(camera.position);
            if (distance < interactionDistanceMushroom) {
                currentInteraction = child;
            }
        }
    });
    // Update the interaction message
    if (currentInteraction) {
        if (currentInteraction.userData?.type === 'painting') {
            interactionMessage.innerText = "Press 'B' to buy artwork";
        } else if (currentInteraction.name.startsWith('mushroom')) {
            interactionMessage.innerText = "Don't press 'E' to eat, it's poison";
        }
        interactionMessage.style.display = 'block';
    } else {
        interactionMessage.style.display = 'none';
    }
}

function startHallucination() {
    hallucinating = true;
    hallucinationStartTime = clock.getElapsedTime();
    glitchPass.enabled = true; // turn glitch on
    // Initialize hue based on current background (necessary?)
    const hsl = {};
    scene.background.getHSL(hsl);
    hallucinationHue = hsl.h;
}

function updateHallucination() {
    if (!hallucinating) return;
    const elapsed = clock.getElapsedTime() - hallucinationStartTime;
    if (elapsed >= hallucinationDuration) {
        // End hallucination
        hallucinating = false;
        scene.background.copy(originalSkyColor);
        glitchPass.enabled = false; // turn glitch off
        return;
    }
    // Increment hue gradually
    hallucinationHue = (hallucinationHue + 0.0015) % 1;
    const hsl_s = 1; // keep full saturation
    const hsl_l = 0.5; // keep mid lightness
    scene.background.setHSL(hallucinationHue,hsl_s,hsl_l);
}

function animate() {
    const deltaTime = Math.min( 0.05, clock.getDelta() ) / STEPS_PER_FRAME;
    // we look for collisions in substeps to mitigate the risk of
    // an object traversing another too quickly for detection.
    for ( let i = 0; i < STEPS_PER_FRAME; i ++ ) {
        controls( deltaTime );
        updatePlayer( deltaTime );
        updateSpheres( deltaTime );
        teleportPlayerIfOob();
    }
    // Interactions with paintings and other "active" objects
    checkInteractions();
    // If we ate mushroom, hallucinate
    updateHallucination();

    composer.render(); // renderer.render( scene, camera );
    stats.update();
}