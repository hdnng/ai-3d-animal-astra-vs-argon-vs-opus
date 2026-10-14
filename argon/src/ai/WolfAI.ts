import * as THREE from 'three';
import { ObstacleCollider, WolfEntity } from '../animal/WolfEntity';
import { Terrain } from '../world/Terrain';
import { EcosystemManager, HareAgent } from '../world/Ecosystem';
import { FoodSite } from '../world/Vegetation';
import { clamp, wrapAngle } from '../utils/math';

export type AIGoalType = 'hunt' | 'forage' | 'drink' | 'rest' | 'howl' | 'patrol';

/**
 * Utility-Based Wolf AI Controller + Steering Obstacle Avoidance + Debug Target Visualizer
 * Scores competing biological drives (hunger, thirst, stamina, pack curiosity)
 * and executes smooth steering around trees, boulders, and deep water.
 */
export class WolfAIController {
  public currentGoal: AIGoalType = 'patrol';
  public targetPosition = new THREE.Vector3(0, 0, 18);
  public debugGroup = new THREE.Group();

  private targetLine: THREE.Line;
  private targetRing: THREE.Mesh;
  private decisionTimer = 0;
  private stateActionTimer = 0;
  private patrolAngle = 0.4;
  private chasedHare: HareAgent | null = null;

  constructor(scene: THREE.Scene) {
    this.debugGroup.visible = false;
    scene.add(this.debugGroup);

    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(0, 1, 5)
    ]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x4db8ff });
    this.targetLine = new THREE.Line(lineGeo, lineMat);
    this.debugGroup.add(this.targetLine);

    const ringGeo = new THREE.RingGeometry(0.45, 0.65, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xf5b942,
      side: THREE.DoubleSide
    });
    this.targetRing = new THREE.Mesh(ringGeo, ringMat);
    this.debugGroup.add(this.targetRing);
  }

  update(
    dt: number,
    wolf: WolfEntity,
    terrain: Terrain,
    ecosystem: EcosystemManager,
    foodSites: FoodSite[],
    obstacles: ObstacleCollider[]
  ): void {
    if (wolf.isManualControl || wolf.actionLockTimer > 0 || wolf.airborneHeight > 0.04) {
      this.updateDebugVisuals(wolf);
      return;
    }

    this.decisionTimer -= dt;
    if (this.stateActionTimer > 0) {
      this.stateActionTimer -= dt;
    }

    // Re-evaluate Utility AI scores periodically or when current action finishes
    if (this.decisionTimer <= 0 && this.stateActionTimer <= 0) {
      this.evaluateUtilityGoals(wolf, terrain, ecosystem, foodSites);
      this.decisionTimer = 1.2;
    }

    this.executeCurrentGoal(dt, wolf, terrain, ecosystem, foodSites, obstacles);
    this.updateDebugVisuals(wolf);
  }

  private evaluateUtilityGoals(
    wolf: WolfEntity,
    terrain: Terrain,
    ecosystem: EcosystemManager,
    foodSites: FoodSite[]
  ): void {
    const { hunger, thirst, energy, curiosity } = wolf.needs;

    // Compute Utility Scores (0..100)
    const uDrink = (100 - thirst) * (thirst < 45 ? 1.65 : 0.85);
    const uFood = (100 - hunger) * (hunger < 50 ? 1.60 : 0.90);
    const uRest = (100 - energy) * (energy < 35 ? 1.75 : 0.70);
    const uHowl = (100 - curiosity) * (curiosity < 45 ? 1.45 : 0.65);
    const uPatrol = 38.0;

    const maxScore = Math.max(uDrink, uFood, uRest, uHowl, uPatrol);

    if (maxScore === uRest && energy < 48) {
      this.currentGoal = 'rest';
      this.stateActionTimer = 4.2;
      wolf.triggerSpecialAction('rest');
      return;
    }

    if (maxScore === uHowl && curiosity < 52) {
      this.currentGoal = 'howl';
      this.stateActionTimer = 3.3;
      wolf.triggerSpecialAction('howl');
      return;
    }

    if (maxScore === uDrink) {
      this.currentGoal = 'drink';
      const shore = terrain.getNearestShoreline(wolf.position);
      this.targetPosition.copy(shore);
      wolf.aiTargetPos = this.targetPosition;
      wolf.lookTarget = this.targetPosition;
      wolf.thoughtIcon = '💧';
      wolf.thoughtText = 'Seeking river shoreline to drink';
      return;
    }

    if (maxScore === uFood) {
      // Check if a live hare is within 28m
      let nearestHare: HareAgent | null = null;
      let bestHareDist = 28.0;
      for (const h of ecosystem.hares) {
        const d = Math.hypot(h.position.x - wolf.position.x, h.position.z - wolf.position.z);
        if (d < bestHareDist) {
          bestHareDist = d;
          nearestHare = h;
        }
      }

      if (nearestHare) {
        this.currentGoal = 'hunt';
        this.chasedHare = nearestHare;
        this.targetPosition.copy(nearestHare.position);
        wolf.aiTargetPos = this.targetPosition;
        wolf.lookTarget = this.targetPosition;
        wolf.thoughtIcon = '🐇';
        wolf.thoughtText = 'Stalking & chasing mountain hare!';
        return;
      }

      // Otherwise navigate to nearest food site
      let bestSite = foodSites[0];
      let bestSiteDist = Infinity;
      for (const s of foodSites) {
        const d = Math.hypot(s.position.x - wolf.position.x, s.position.z - wolf.position.z);
        if (d < bestSiteDist) {
          bestSiteDist = d;
          bestSite = s;
        }
      }
      if (bestSite) {
        this.currentGoal = 'forage';
        this.targetPosition.copy(bestSite.position);
        wolf.aiTargetPos = this.targetPosition;
        wolf.lookTarget = this.targetPosition;
        wolf.thoughtIcon = '🥩';
        wolf.thoughtText = `Trotting to ${bestSite.type} to feed`;
        return;
      }
    }

    // Default: Patrol scenic meadow & territory
    if (this.currentGoal !== 'patrol' || wolf.position.distanceTo(this.targetPosition) < 4.5) {
      this.currentGoal = 'patrol';
      this.pickNextPatrolPoint(wolf, terrain);
    }
  }

  private pickNextPatrolPoint(wolf: WolfEntity, terrain: Terrain): void {
    for (let i = 0; i < 12; i++) {
      this.patrolAngle += 0.65 + Math.random() * 0.9;
      const radius = 16 + (i % 3) * 10;
      const tx = clamp(Math.cos(this.patrolAngle) * radius, -55, 55);
      const tz = clamp(Math.sin(this.patrolAngle) * radius + 6, -55, 55);
      const ty = terrain.getHeightAt(tx, tz);
      if (ty > terrain.waterLevel + 0.35 && ty < 6.5) {
        this.targetPosition.set(tx, ty, tz);
        wolf.aiTargetPos = this.targetPosition;
        wolf.lookTarget = this.targetPosition;
        wolf.thoughtIcon = '🧭';
        wolf.thoughtText = 'Patrolling alpine meadow';
        return;
      }
    }
  }

  private executeCurrentGoal(
    dt: number,
    wolf: WolfEntity,
    terrain: Terrain,
    ecosystem: EcosystemManager,
    foodSites: FoodSite[],
    obstacles: ObstacleCollider[]
  ): void {
    if (this.currentGoal === 'rest' || this.currentGoal === 'howl') {
      wolf.targetSpeed = 0;
      wolf.speed = clamp(wolf.speed - 10 * dt, 0, 10);
      wolf.turnRate = 0;
      return;
    }

    if (this.currentGoal === 'hunt' && this.chasedHare) {
      this.targetPosition.copy(this.chasedHare.position);
    }

    const dx = this.targetPosition.x - wolf.position.x;
    const dz = this.targetPosition.z - wolf.position.z;
    const dist = Math.hypot(dx, dz);

    // Check arrival actions
    if (this.currentGoal === 'hunt' && this.chasedHare) {
      if (dist < 3.4 && dist > 1.4 && wolf.airborneHeight <= 0.04) {
        wolf.triggerSpecialAction('pounce');
      } else if (dist <= 1.55) {
        // Caught prey -> feed!
        ecosystem.respawnHare(this.chasedHare);
        this.chasedHare = null;
        this.currentGoal = 'forage';
        this.stateActionTimer = 3.0;
        wolf.animator.setState('eat');
        wolf.speed = 0;
        wolf.needs.hunger = Math.min(100, wolf.needs.hunger + 38);
        wolf.thoughtIcon = '🥩';
        wolf.thoughtText = 'Caught prey! Feeding to restore satiety';
        return;
      }
    }

    if (this.currentGoal === 'forage' && dist < 1.8) {
      wolf.speed = 0;
      wolf.targetSpeed = 0;
      wolf.turnRate = 0;
      wolf.animator.setState('eat');
      wolf.needs.hunger = Math.min(100, wolf.needs.hunger + dt * 22);
      wolf.thoughtIcon = '🥩';
      wolf.thoughtText = 'Feeding at forage site';
      if (wolf.needs.hunger >= 94) {
        this.decisionTimer = 0;
      }
      return;
    }

    if (this.currentGoal === 'drink' && dist < 2.2) {
      wolf.speed = 0;
      wolf.targetSpeed = 0;
      wolf.turnRate = 0;
      wolf.animator.setState('drink');
      wolf.needs.thirst = Math.min(100, wolf.needs.thirst + dt * 25);
      wolf.thoughtIcon = '💧';
      wolf.thoughtText = 'Drinking fresh alpine river water';
      if (wolf.needs.thirst >= 95) {
        this.decisionTimer = 0;
      }
      return;
    }

    if (this.currentGoal === 'patrol' && dist < 2.8) {
      this.pickNextPatrolPoint(wolf, terrain);
    }

    // Steering + Obstacle Avoidance around trees & rocks
    let steerX = dx / Math.max(0.001, dist);
    let steerZ = dz / Math.max(0.001, dist);

    const lookAhead = 4.2;
    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      const ox = wolf.position.x - obs.x;
      const oz = wolf.position.z - obs.z;
      const dSq = ox * ox + oz * oz;
      const avoidRad = obs.radius + lookAhead;
      if (dSq < avoidRad * avoidRad && dSq > 0.001) {
        const d = Math.sqrt(dSq);
        const weight = Math.pow((avoidRad - d) / avoidRad, 2) * 2.6;
        steerX += (ox / d) * weight;
        steerZ += (oz / d) * weight;
      }
    }

    const desiredHeading = Math.atan2(steerX, steerZ);
    const angleDiff = wrapAngle(desiredHeading - wolf.heading);

    wolf.turnRate = clamp(angleDiff * 3.2, -2.8, 2.8);
    wolf.heading = wrapAngle(wolf.heading + wolf.turnRate * dt);

    if (this.currentGoal === 'hunt') {
      wolf.targetSpeed = 7.6;
    } else if (dist > 14.0 && wolf.needs.energy > 50) {
      wolf.targetSpeed = 5.6;
    } else {
      wolf.targetSpeed = 3.1;
    }

    // Slow down slightly during sharp turns
    wolf.targetSpeed *= 1.0 - clamp(Math.abs(angleDiff) / Math.PI, 0, 0.55);

    const accel = 7.5;
    wolf.speed += clamp(wolf.targetSpeed - wolf.speed, -accel * dt, accel * dt);

    if (wolf.airborneHeight <= 0.05) {
      if (wolf.position.y < terrain.waterLevel - 0.32) {
        wolf.animator.setState('swim');
        wolf.thoughtIcon = '🌊';
        wolf.thoughtText = 'Swimming across alpine river';
      } else if (wolf.speed > 4.4) {
        wolf.animator.setState('run');
        if (this.currentGoal === 'patrol') {
          wolf.thoughtIcon = '🐾';
          wolf.thoughtText = 'Cantering across alpine meadow';
        }
      } else if (wolf.speed > 0.25) {
        wolf.animator.setState('walk');
        if (this.currentGoal === 'patrol') {
          wolf.thoughtIcon = '🧭';
          wolf.thoughtText = 'Patrolling pack territory';
        }
      } else {
        wolf.animator.setState('idle');
      }
    }
  }

  private updateDebugVisuals(wolf: WolfEntity): void {
    if (!this.debugGroup.visible) return;

    const target = wolf.aiTargetPos ?? this.targetPosition;
    const posAttr = this.targetLine.geometry.attributes.position as THREE.BufferAttribute;
    posAttr.setXYZ(0, wolf.position.x, wolf.position.y + 0.55, wolf.position.z);
    posAttr.setXYZ(1, target.x, target.y + 0.35, target.z);
    posAttr.needsUpdate = true;

    this.targetRing.position.set(target.x, target.y + 0.08, target.z);
  }
}
