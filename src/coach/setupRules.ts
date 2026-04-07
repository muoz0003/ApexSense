/**
 * Setup Rules Knowledge Base
 *
 * Maps driving problems to setup direction adjustments, organized by car category.
 * Recommendations are ordered by expected impact (highest first).
 */

export type ProblemId =
  | 'understeer_entry'
  | 'oversteer_exit'
  | 'poor_traction'
  | 'understeer_mid'
  | 'oversteer_mid'
  | 'braking_instability'
  | 'bad_topspeed'
  | 'general_understeer'
  | 'general_oversteer';

export type CarCategory =
  | 'formula'     // Open-wheel: F3, F4, IndyCar, Pro Mazda
  | 'gt'          // GT3, GT4, GTE
  | 'prototype'   // LMP2, LMDh/GTP
  | 'stockcar'    // NASCAR, ARCA
  | 'touring'     // TCR, Touring
  | 'sportsman'   // Skip Barber, MX-5, Street Stock
  | 'unknown';

export interface SetupAdjustment {
  component: string;
  direction: string;          // Human-readable instruction, e.g. "Soften 2-3 clicks"
  /** Per-category direction override — supersedes `direction` for matching categories. */
  categoryDirections?: Partial<Record<CarCategory, string>>;
  explanation: string;        // Why this helps
  impact: 'high' | 'medium' | 'low';
  categories: CarCategory[];  // Which categories this applies to (empty = all)
}

export interface ProblemRule {
  id: ProblemId;
  label: string;
  description: string;
  icon: string;
  telemetryHints: string[];       // What metrics correlate with this problem
  adjustments: SetupAdjustment[]; // Ordered by impact (high first)
}

// ─── Car detection helpers ────────────────────────────────────────────────────

// Map carPath / carName substrings → category. Lowercase matching.
const CAR_CATEGORY_MAP: Array<{ pattern: string; category: CarCategory }> = [
  // Formula
  { pattern: 'dallara_f3',           category: 'formula' },
  { pattern: 'dallara_f2',           category: 'formula' },
  { pattern: 'dallara_ir18',         category: 'formula' },
  { pattern: 'dallara_f317',         category: 'formula' },
  { pattern: 'hpd',                  category: 'formula' },
  { pattern: 'indypro2000',          category: 'formula' },
  { pattern: 'mercedesamgw13',       category: 'formula' },
  { pattern: 'formula_renault',      category: 'formula' },
  { pattern: 'pro_mazda',            category: 'formula' },
  { pattern: 'skip_barber',          category: 'sportsman' },
  { pattern: 'f3',                   category: 'formula' },
  // GT
  { pattern: 'ferrari_488_gt3',      category: 'gt' },
  { pattern: 'ferrari_488_gte',      category: 'gt' },
  { pattern: 'bmw_m4_gt3',           category: 'gt' },
  { pattern: 'bmw_m8_gte',           category: 'gt' },
  { pattern: 'porsche_992_gt3r',     category: 'gt' },
  { pattern: 'porsche_911_gt3r',     category: 'gt' },
  { pattern: 'porsche_991_gt3r',     category: 'gt' },
  { pattern: 'lamborghini_huracan',  category: 'gt' },
  { pattern: 'audi_r8_lms',          category: 'gt' },
  { pattern: 'mercedes_amg_gt3',     category: 'gt' },
  { pattern: 'mclaren_720s',         category: 'gt' },
  { pattern: 'aston_martin_gt3',     category: 'gt' },
  { pattern: 'corvette_z06_gt3',     category: 'gt' },
  { pattern: 'gt3',                  category: 'gt' },
  { pattern: 'gt4',                  category: 'gt' },
  { pattern: 'gte',                  category: 'gt' },
  // Prototypes
  { pattern: 'ligier_js_p320',       category: 'prototype' },
  { pattern: 'oreca_07',             category: 'prototype' },
  { pattern: 'cadillac_v_series',    category: 'prototype' },
  { pattern: 'bmw_m_hybrid',         category: 'prototype' },
  { pattern: 'acura_arx',            category: 'prototype' },
  { pattern: 'lmp2',                 category: 'prototype' },
  { pattern: 'lmdh',                 category: 'prototype' },
  { pattern: 'gtp',                  category: 'prototype' },
  // Touring / TCR
  { pattern: 'hyundai_elantra_n',    category: 'touring' },
  { pattern: 'honda_civic',          category: 'touring' },
  { pattern: 'audi_rs3',             category: 'touring' },
  { pattern: 'tcr',                  category: 'touring' },
  // Stock Cars
  { pattern: 'NASCAR',               category: 'stockcar' },
  { pattern: 'nxt',                  category: 'stockcar' },
  { pattern: 'cup',                  category: 'stockcar' },
  { pattern: 'xfinity',              category: 'stockcar' },
  { pattern: 'truck',                category: 'stockcar' },
  { pattern: 'arca',                 category: 'stockcar' },
  { pattern: 'super_late_model',     category: 'stockcar' },
  // Sportsman
  { pattern: 'mx5',                  category: 'sportsman' },
  { pattern: 'miata',                category: 'sportsman' },
  { pattern: 'skipbarber',           category: 'sportsman' },
  { pattern: 'street',               category: 'sportsman' },
];

export function detectCarCategory(carPath: string, carName: string): CarCategory {
  const lower = (carPath + ' ' + carName).toLowerCase();
  for (const { pattern, category } of CAR_CATEGORY_MAP) {
    if (lower.includes(pattern.toLowerCase())) return category;
  }
  return 'unknown';
}

// ─── Rules Database ───────────────────────────────────────────────────────────

export const PROBLEM_RULES: ProblemRule[] = [
  {
    id: 'understeer_entry',
    label: 'Understeer on Entry',
    description: 'Car pushes or plows when turning in — front loses grip before the rear.',
    icon: '↗',
    telemetryHints: [
      'High steering angle while speed is still high at corner entry',
      'Front tires running cooler than rears (front not working hard enough)',
      'Driver applying throttle / releasing brake slowly before turn-in',
    ],
    adjustments: [
      {
        component: 'Front Wing / Aero',
        direction: 'Increase front wing angle 1-2 clicks',
        categoryDirections: { prototype: 'Increase rear wing angle by 0.5–1.0° (e.g. 10.5° → 11.0–11.5°)', formula: 'Increase front wing 1-2 clicks' },
        explanation: 'More front downforce pins the front tyres more aggressively. Most effective on high-speed circuits.',
        impact: 'high',
        categories: ['formula', 'gt', 'prototype'],
      },
      {
        component: 'Front Anti-Roll Bar',
        direction: 'Soften front ARB 2-3 clicks',
        categoryDirections: { prototype: 'Soften front ARB one step (e.g. Hard → Medium, or Medium → Soft)', touring: 'Soften front ARB 2-3 clicks' },
        explanation: 'A softer front ARB allows more body roll, increasing front tyre contact patch load during cornering and reducing understeer.',
        impact: 'high',
        categories: ['formula', 'gt', 'prototype', 'touring'],
      },
      {
        component: 'Brake Bias',
        direction: 'Move brake bias rearward 0.5-1%',
        explanation: 'More rear braking helps rotate the car on entry. If front brakes lock first, this directly reduces push-understeer at turn-in.',
        impact: 'high',
        categories: ['formula', 'gt', 'prototype', 'touring', 'sportsman'],
      },
      {
        component: 'Front Spring Rate',
        direction: 'Soften front springs 5-10%',
        explanation: 'Softer springs allow the front to compress more, maximising contact patch area and grip at corner entry.',
        impact: 'medium',
        categories: ['gt', 'prototype', 'touring', 'sportsman'],
      },
      {
        component: 'Front Camber',
        direction: 'Add more negative front camber (-0.1° to -0.3°)',
        explanation: 'More negative camber keeps the tyre contact patch flatter when the car is rolling, recovering grip mid-corner.',
        impact: 'medium',
        categories: ['formula', 'gt', 'prototype', 'touring', 'sportsman'],
      },
      {
        component: 'Front Toe',
        direction: 'Reduce front toe-in slightly (toward zero or slight toe-out)',
        explanation: 'A little toe-out on the front increases turn-in responsiveness, reducing initial understeer feeling.',
        impact: 'medium',
        categories: ['gt', 'prototype', 'touring'],
      },
      {
        component: 'Tire Pressure (Front)',
        direction: 'Reduce front cold pressure by 0.05-0.1 bar',
        explanation: 'Slightly lower pressure widens the contact patch and softens initial response, helping grip at entry.',
        impact: 'low',
        categories: ['formula', 'gt', 'prototype', 'touring', 'sportsman'],
      },
      {
        component: 'Nose Wedge / Left Rear Wedge',
        direction: 'Add 1-3 turns nose wedge (left rear jacking bolt)',
        explanation: 'On oval setups, adding wedge increases cross-weight to the left-rear, tightening corner entry for ovals.',
        impact: 'high',
        categories: ['stockcar'],
      },
      {
        component: 'Rear Track Bar Height',
        direction: 'Raise rear track bar height',
        explanation: 'Raising the track bar shifts weight to the outside rear tyre, helping rotate the car into corners on ovals.',
        impact: 'high',
        categories: ['stockcar'],
      },
    ],
  },

  {
    id: 'oversteer_exit',
    label: 'Snap Oversteer on Exit',
    description: 'Rear snaps out or steps away when applying throttle on corner exit.',
    icon: '↩',
    telemetryHints: [
      'High throttle input combined with high lateral acceleration',
      'Rear tyres running significantly hotter than fronts',
      'RPM spike or traction loss signal at corner exit',
    ],
    adjustments: [
      {
        component: 'Rear Anti-Roll Bar',
        direction: 'Soften rear ARB 2-3 clicks',
        categoryDirections: { prototype: 'Soften rear ARB one step (e.g. Hard → Medium, or Medium → Soft)' },
        explanation: 'A softer rear ARB reduces the amount of load transferred to the outside rear under acceleration, making the rear more predictable.',
        impact: 'high',
        categories: ['formula', 'gt', 'prototype', 'touring', 'sportsman'],
      },
      {
        component: 'Rear Wing / Aero',
        direction: 'Increase rear wing angle 1-2 clicks',
        categoryDirections: { prototype: 'Increase rear wing angle by 0.5–1.0° (e.g. 10.5° → 11.0–11.5°)' },
        explanation: 'More rear downforce loads the rear tyres with downforce, increasing grip under acceleration. Costs some top speed.',
        impact: 'high',
        categories: ['formula', 'gt', 'prototype'],
      },
      {
        component: 'Rear Spring Rate',
        direction: 'Soften rear springs 5-10%',
        explanation: 'Softer rear springs allow more mechanical grip under acceleration loading.',
        impact: 'medium',
        categories: ['gt', 'prototype', 'touring', 'sportsman'],
      },
      {
        component: 'Rear Toe',
        direction: 'Add more rear toe-in (1-2 clicks)',
        categoryDirections: { prototype: 'Add more rear toe-in (+0.1 to +0.2 mm, e.g. +0.4 → +0.5–0.6 mm)' },
        explanation: 'Toe-in on the rear increases straight-line stability and reduces snap oversteer tendency under throttle.',
        impact: 'medium',
        categories: ['formula', 'gt', 'prototype', 'touring'],
      },
      {
        component: 'Differential',
        direction: 'Reduce diff coast ramp angle (less locking on lift-off)',
        explanation: 'If the oversteer is triggered by lift-off rather than throttle application, reducing coast lock prevents the rear from snapping when closing the throttle.',
        impact: 'medium',
        categories: ['formula', 'gt', 'prototype'],
      },
      {
        component: 'Rear Camber',
        direction: 'Reduce rear negative camber by 0.1-0.2°',
        explanation: 'Less negative rear camber increases the contact patch on exit, improving rear traction and stability.',
        impact: 'low',
        categories: ['gt', 'prototype', 'touring'],
      },
      {
        component: 'Rear LS Comp',
        direction: 'Stiffen rear LS compression 2-3 clicks',
        explanation: 'More low-speed compression resistance slows rear squat under throttle, reducing the weight transfer that causes exit oversteer.',
        impact: 'medium',
        categories: ['prototype', 'formula'],
      },
      {
        component: 'Rear LS Rebound',
        direction: 'Soften rear LS rebound 1-2 clicks',
        explanation: 'Faster rear rebound allows the suspension to recover quickly after braking, reducing rear step-out at the exit phase.',
        impact: 'low',
        categories: ['prototype', 'formula'],
      },
      {
        component: 'Right Rear Spring (Oval)',
        direction: 'Stiffen right rear spring',
        explanation: 'On ovals, a stiffer right rear resists the load transfer and helps prevent rear breakaway on exit.',
        impact: 'high',
        categories: ['stockcar'],
      },
    ],
  },

  {
    id: 'poor_traction',
    label: 'Poor Traction on Exit',
    description: 'Rear wheels spin or car struggles to accelerate cleanly out of slow corners.',
    icon: '🔥',
    telemetryHints: [
      'High throttle with low longitudinal acceleration (wheelspin)',
      'Rear tyre temperatures much higher than fronts',
      'RPM disproportionately high relative to speed increase',
    ],
    adjustments: [
      {
        component: 'Differential (Power / Drive Ramp)',
        direction: 'Increase diff power ramp angle (more locking under power)',
        explanation: 'More locking under throttle distributes torque more evenly between rear wheels, reducing inside-wheel spin.',
        impact: 'high',
        categories: ['formula', 'gt', 'prototype'],
      },
      {
        component: 'Rear Anti-Roll Bar',
        direction: 'Soften rear ARB 2-3 clicks',
        explanation: 'Reducing rear roll stiffness allows more weight to the outside rear tyre, improving traction.',
        impact: 'high',
        categories: ['formula', 'gt', 'prototype', 'touring', 'sportsman'],
      },
      {
        component: 'Throttle Technique',
        direction: 'Apply throttle earlier but more gradually from apex',
        explanation: 'Mechanical advice: progressive throttle application prevents peak wheelspin better than any setup change.',
        impact: 'high',
        categories: ['formula', 'gt', 'prototype', 'touring', 'sportsman', 'stockcar'],
      },
      {
        component: 'Rear Camber',
        direction: 'Reduce rear negative camber by 0.1-0.2°',
        explanation: 'Bringing rear camber closer to zero on exit improves the contact patch during straight-line acceleration.',
        impact: 'medium',
        categories: ['formula', 'gt', 'prototype', 'touring'],
      },
      {
        component: 'Rear Tyre Pressure',
        direction: 'Reduce rear cold pressure by 0.05-0.1 bar',
        explanation: 'Slightly lower pressures increase the contact patch size, providing more traction at low slip angles.',
        impact: 'medium',
        categories: ['formula', 'gt', 'prototype', 'touring', 'sportsman'],
      },
      {
        component: 'Rear Spring Rate',
        direction: 'Soften rear springs 5%',
        explanation: 'Softer rears allow more mechanical grip under full load at exit.',
        impact: 'medium',
        categories: ['gt', 'prototype', 'touring'],
      },
      {
        component: 'Rear LS Comp',
        direction: 'Soften rear LS compression 1-2 clicks',
        explanation: 'Less low-speed compression resistance allows the rear suspension to squat slightly under throttle, planting the rear tyres for better traction.',
        impact: 'medium',
        categories: ['prototype', 'formula'],
      },
    ],
  },

  {
    id: 'understeer_mid',
    label: 'Understeer Mid-Corner',
    description: 'Front pushes wide at the apex — car won\'t rotate when cornering speed is highest.',
    icon: '⟳',
    telemetryHints: [
      'High steering angle combined with high lateral acceleration (front saturated)',
      'Front tyre inner temperatures notably hotter (overloaded front)',
      'Consistent high steering lock through mid-corner phase',
    ],
    adjustments: [
      {
        component: 'Front Camber',
        direction: 'Add more negative front camber (-0.2° to -0.4°)',
        explanation: 'Mid-corner understeer often means the front tyres are working at high slip angles. More negative camber keeps the contact patch optimal.',
        impact: 'high',
        categories: ['formula', 'gt', 'prototype', 'touring', 'sportsman'],
      },
      {
        component: 'Front Anti-Roll Bar',
        direction: 'Soften front ARB 1-2 clicks',
        categoryDirections: { prototype: 'Soften front ARB one step (e.g. Hard → Medium, or Medium → Soft)' },
        explanation: 'Less roll stiffness at the front allows a tiny increase in weight transfer to the outer tyre, distributing load more evenly.',
        impact: 'high',
        categories: ['formula', 'gt', 'prototype', 'touring'],
      },
      {
        component: 'Rear Wing / Aero Balance',
        direction: 'Reduce rear wing by 1 click (shift aero balance forward)',
        categoryDirections: { prototype: 'Reduce rear wing angle by 0.5° to shift aero balance forward' },
        explanation: 'Less rear downforce relative to front shifts the aerodynamic balance forward, fighting mid-corner push.',
        impact: 'medium',
        categories: ['formula', 'gt', 'prototype'],
      },
      {
        component: 'Front Ride Height',
        direction: 'Raise front ride height slightly',
        explanation: 'Higher front ride height can improve the front diffuser/splitter efficiency on downforce cars.',
        impact: 'medium',
        categories: ['formula', 'prototype'],
      },
      {
        component: 'Front Spring Rate',
        direction: 'Reduce front spring rate 5-8%',
        explanation: 'Softer front springs allow the splitter/wing to generate more consistent downforce by keeping the car flatter.',
        impact: 'low',
        categories: ['gt', 'prototype', 'touring'],
      },
    ],
  },

  {
    id: 'oversteer_mid',
    label: 'Oversteer Mid-Corner',
    description: 'Rear steps out or feels loose when maintaining cornering speed at the apex.',
    icon: '↻',
    telemetryHints: [
      'Rear tyre temps considerably hotter than fronts (rear overloaded)',
      'Steering corrections mid-corner (counter-steer inputs)',
      'High lateral acceleration with modest steering angle (rear sliding)',
    ],
    adjustments: [
      {
        component: 'Rear Anti-Roll Bar',
        direction: 'Stiffen rear ARB 2-3 clicks',
        categoryDirections: { prototype: 'Stiffen rear ARB one step (e.g. Soft → Medium, or Medium → Hard)' },
        explanation: 'More rear roll stiffness reduces the amount of weight transferred to the outer rear, stabilising the rear mid-corner.',
        impact: 'high',
        categories: ['formula', 'gt', 'prototype', 'touring'],
      },
      {
        component: 'Rear Wing / Aero',
        direction: 'Increase rear wing 1-2 clicks',
        categoryDirections: { prototype: 'Increase rear wing angle by 0.5–1.0° (e.g. 10.5° → 11.0–11.5°)' },
        explanation: 'More rear downforce directly loads the rear tyres, reducing slip angle and stabilising the rear mid-corner.',
        impact: 'high',
        categories: ['formula', 'gt', 'prototype'],
      },
      {
        component: 'Rear Toe',
        direction: 'Increase rear toe-in slightly',
        categoryDirections: { prototype: 'Add rear toe-in +0.1 mm (e.g. +0.4 → +0.5 mm)' },
        explanation: 'More rear toe-in improves directional stability through corners, calming a nervous rear.',
        impact: 'medium',
        categories: ['formula', 'gt', 'prototype', 'touring'],
      },
      {
        component: 'Rear Spring Rate',
        direction: 'Stiffen rear springs 5%',
        explanation: 'Stiffer rear springs reduce rear squat/roll, keeping the tyre perpendicular to the road.',
        impact: 'medium',
        categories: ['gt', 'prototype', 'touring', 'sportsman'],
      },
      {
        component: 'Rear Camber',
        direction: 'Reduce rear negative camber by 0.1-0.2°',
        explanation: 'Less negative rear camber increases straight-line and high-force contact patch area.',
        impact: 'low',
        categories: ['gt', 'prototype', 'touring'],
      },
    ],
  },

  {
    id: 'braking_instability',
    label: 'Unstable Under Braking',
    description: 'Car dances, rotates, or locks up unpredictably when braking hard.',
    icon: '⚠',
    telemetryHints: [
      'Rear tyre temps spiking during braking zones',
      'Large corrections in steering angle during high brake input',
      'Longitudinal deceleration inconsistent across successive braking zones',
    ],
    adjustments: [
      {
        component: 'Brake Bias',
        direction: 'Move brake bias forward 1-2%',
        explanation: 'If the rear locks or snaps under braking, the rear brakes are contributing too much. Moving bias forward stabilises braking.',
        impact: 'high',
        categories: ['formula', 'gt', 'prototype', 'touring', 'sportsman'],
      },
      {
        component: 'Rear Anti-Roll Bar',
        direction: 'Stiffen rear ARB slightly',
        categoryDirections: { prototype: 'Stiffen rear ARB one step (e.g. Soft → Medium)' },
        explanation: 'More rear roll stiffness helps keep the rear stable and prevents rear-end movement under longitudinal loads.',
        impact: 'medium',
        categories: ['formula', 'gt', 'prototype', 'touring'],
      },
      {
        component: 'Rear Bumpstop / Spring',
        direction: 'Stiffen rear bumpstop range or raise preload',
        explanation: 'Prevents excessive rear squat under braking, which can cause rear brake lock-up.',
        impact: 'medium',
        categories: ['formula', 'gt', 'prototype'],
      },
      {
        component: 'Rear Ride Height',
        direction: 'Lower rear ride height slightly',
        explanation: 'A lower centre of gravity reduces load transfer under braking, improving stability.',
        impact: 'medium',
        categories: ['gt', 'prototype'],
      },
      {
        component: 'Front HS Comp',
        direction: 'Stiffen front HS compression 2-3 clicks',
        explanation: 'High-speed compression controls the initial dive under heavy braking. More stiffness keeps the nose planted and the brake balance predictable.',
        impact: 'medium',
        categories: ['prototype', 'formula'],
      },
      {
        component: 'Rear HS Comp',
        direction: 'Stiffen rear HS compression 1-2 clicks',
        explanation: 'Preventing excessive rear suspension movement under hard braking reduces rear-end instability and squat under trail braking.',
        impact: 'low',
        categories: ['prototype', 'formula'],
      },
      {
        component: 'Braking Technique',
        direction: 'Release brake pressure progressively (trail-brake)',
        explanation: 'Abrupt brake release transfers weight rapidly to the rear, causing snap. A smooth release maintains stability.',
        impact: 'high',
        categories: ['formula', 'gt', 'prototype', 'touring', 'sportsman', 'stockcar'],
      },
    ],
  },

  {
    id: 'bad_topspeed',
    label: 'Poor Top Speed / High Drag',
    description: 'Car is noticeably slow on straights compared to expected performance.',
    icon: '→',
    telemetryHints: [
      'Full throttle with low longitudinal acceleration on long straights',
      'Speed plateau well below series average at similar power',
      'High engine RPM but speed isn\'t keeping pace (excessive drag)',
    ],
    adjustments: [
      {
        component: 'Rear Wing Angle',
        direction: 'Reduce rear wing angle 2-3 clicks (low-drag setting)',
        categoryDirections: { prototype: 'Reduce rear wing angle by 1.0–1.5° (e.g. 10.5° → 9.0–9.5°)' },
        explanation: 'Every degree of wing removed reduces drag considerably. For circuits with long straights, a lower wing is usually faster overall.',
        impact: 'high',
        categories: ['formula', 'gt', 'prototype'],
      },
      {
        component: 'Front Wing Angle',
        direction: 'Reduce front wing angle to minimum balanced setting',
        categoryDirections: { prototype: 'Switch front dive planes to LDF or remove gurney to reduce drag while maintaining aero balance' },
        explanation: 'Matching front wing reduction to the rear keeps the aero balance neutral while reducing total drag.',
        impact: 'high',
        categories: ['formula', 'prototype'],
      },
      {
        component: 'Ride Height',
        direction: 'Lower overall ride height (within regulation minimum)',
        explanation: 'Lower ride height reduces aerodynamic drag from underbody exposure. Do not go below minimum ride heights.',
        impact: 'medium',
        categories: ['formula', 'gt', 'prototype', 'touring'],
      },
      {
        component: 'Gear Ratio (Final Drive)',
        direction: 'Lengthen final drive/top gear ratio',
        explanation: 'A taller final gear allows the engine to reach higher road speed before hitting the rev limiter.',
        impact: 'medium',
        categories: ['formula', 'gt', 'prototype'],
      },
      {
        component: 'Tyre Pressure',
        direction: 'Raise cold tyre pressures slightly (+0.05 bar)',
        explanation: 'Higher pressures reduce rolling resistance and tyre squirm on straights, giving marginally better top speed.',
        impact: 'low',
        categories: ['formula', 'gt', 'prototype', 'touring', 'sportsman'],
      },
    ],
  },

  {
    id: 'general_understeer',
    label: 'General / Everywhere Understeer',
    description: 'Front feels dull and unresponsive throughout the entire lap.',
    icon: '⟵',
    telemetryHints: [
      'Consistently high steering lock across all corner types',
      'Front tyre wear much higher than rear',
      'Low front tyre temperatures (not reaching working range)',
    ],
    adjustments: [
      {
        component: 'Front Wing / Aero',
        direction: 'Increase front wing 2-3 clicks',
        categoryDirections: { prototype: 'Increase rear wing angle by 1.0–1.5° or switch to higher downforce dive planes' },
        explanation: 'A front-biased aero balance provides consistent front grip everywhere on the track.',
        impact: 'high',
        categories: ['formula', 'prototype'],
      },
      {
        component: 'Front Anti-Roll Bar',
        direction: 'Soften front ARB 3-4 clicks',
        categoryDirections: { prototype: 'Soften front ARB one or two steps (e.g. Hard → Soft)' },
        explanation: 'Reducing front roll resistance allows the outer front tyre to load up properly in all corner types.',
        impact: 'high',
        categories: ['formula', 'gt', 'prototype', 'touring', 'sportsman'],
      },
      {
        component: 'Front Camber',
        direction: 'Add more negative front camber (-0.3° to -0.5°)',
        explanation: 'More negative camber helps the front contact patch remain optimal through long corners.',
        impact: 'medium',
        categories: ['formula', 'gt', 'prototype', 'touring', 'sportsman'],
      },
      {
        component: 'Front Spring Rate',
        direction: 'Soften front springs 10%',
        explanation: 'Softer springs lower front ride height under load and improve mechanical grip everywhere.',
        impact: 'medium',
        categories: ['gt', 'prototype', 'touring', 'sportsman'],
      },
      {
        component: 'Rear Wing / Aero',
        direction: 'Reduce rear wing 1-2 clicks to shift balance forward',
        categoryDirections: { prototype: 'Reduce rear wing angle by 0.5° to shift aero balance forward' },
        explanation: 'Less rear downforce makes the car feel more neutral, reducing end-to-end balance bias toward the front.',
        impact: 'medium',
        categories: ['formula', 'gt', 'prototype'],
      },
    ],
  },

  {
    id: 'general_oversteer',
    label: 'General / Everywhere Oversteer',
    description: 'Rear feels loose and nervous throughout the entire lap.',
    icon: '⟶',
    telemetryHints: [
      'Rear tyre temperatures consistently higher than fronts all lap',
      'Frequent small steering corrections throughout corners',
      'Rear tyre wear noticeably higher than front',
    ],
    adjustments: [
      {
        component: 'Rear Wing / Aero',
        direction: 'Increase rear wing 2-3 clicks',
        categoryDirections: { prototype: 'Increase rear wing angle by 1.0–1.5° (e.g. 10.5° → 11.5–12.0°)' },
        explanation: 'More rear downforce fundamentally increases rear grip and stability everywhere on track.',
        impact: 'high',
        categories: ['formula', 'gt', 'prototype'],
      },
      {
        component: 'Rear Anti-Roll Bar',
        direction: 'Soften rear ARB 3-4 clicks',
        categoryDirections: { prototype: 'Soften rear ARB one or two steps (e.g. Hard → Medium or Hard → Soft)' },
        explanation: 'Softer rear ARB reduces peak lateral load on the outer rear tyre, preventing overload and snap oversteer.',
        impact: 'high',
        categories: ['formula', 'gt', 'prototype', 'touring', 'sportsman'],
      },
      {
        component: 'Rear Spring Rate',
        direction: 'Stiffen rear springs 5-10%',
        explanation: 'Stiffer rear springs reduce squat and keep the rear planted in all conditions.',
        impact: 'medium',
        categories: ['gt', 'prototype', 'touring', 'sportsman'],
      },
      {
        component: 'Rear Toe',
        direction: 'Increase rear toe-in 0.1-0.2°',
        explanation: 'More rear toe-in creates passive stability — the car resists yaw and goes straighter, calming oversteer tendencies.',
        impact: 'medium',
        categories: ['formula', 'gt', 'prototype', 'touring'],
      },
      {
        component: 'Front Camber',
        direction: 'Reduce front negative camber slightly',
        explanation: 'If the front is over-gripping and rotating the rear, slightly reducing front camber can restore balance.',
        impact: 'low',
        categories: ['gt', 'prototype', 'touring'],
      },
    ],
  },
];

export function getRulesForProblem(problemId: ProblemId): ProblemRule | undefined {
  return PROBLEM_RULES.find(r => r.id === problemId);
}

// ─── iRacing Garage location map ─────────────────────────────────────────────
// Each key matches SetupAdjustment.component exactly.
// Value format: "Tab → Section → Field"
export const COMPONENT_LOCATIONS: Record<string, string> = {
  // Wings / Aero
  'Front Wing / Aero':         'Chassis → Rear section → Wing angle',
  'Front Wing Angle':          'Chassis → Rear section → Wing angle',
  'Rear Wing / Aero':          'Chassis → Rear section → Wing angle',
  'Rear Wing Angle':           'Chassis → Rear section → Wing angle',
  'Rear Wing / Aero Balance':  'Chassis → Rear section → Wing angle',
  // Anti-roll bars
  'Front Anti-Roll Bar':       'Chassis → Front/Brakes → ARB setting',
  'Rear Anti-Roll Bar':        'Chassis → Rear section → ARB setting',
  // Springs
  'Front Spring Rate':         'Chassis → Left Front / Right Front → Spring rate',
  'Rear Spring Rate':          'Chassis → Left Rear / Right Rear → Spring rate',
  'Right Rear Spring (Oval)':  'Chassis → Right Rear → Spring rate',
  // Ride height (via spring perch offset in iRacing)
  'Front Ride Height':         'Chassis → Left Front / Right Front → Spring perch offset',
  'Rear Ride Height':          'Chassis → Left Rear / Right Rear → Spring perch offset',
  'Ride Height':               'Chassis → All corners → Spring perch offset',
  // Camber
  'Front Camber':              'Chassis → Left Front / Right Front → Camber',
  'Rear Camber':               'Chassis → Left Rear / Right Rear → Camber',
  // Toe
  'Front Toe':                 'Chassis → Front/Brakes → Toe-in',
  'Rear Toe':                  'Chassis → Left Rear / Right Rear → Toe-in',
  // Dampers
  'Rear Bumpstop / Spring':    'Chassis → Left Rear / Right Rear → Bump stiffness / Rebound stiffness',
  // Tyres / pressures
  'Tire Pressure (Front)':     'Tires → Left Front / Right Front → Starting pressure',
  'Rear Tyre Pressure':        'Tires → Left Rear / Right Rear → Starting pressure',
  'Tyre Pressure':             'Tires → All corners → Starting pressure',
  // Brakes
  'Brake Bias':                'Chassis → In-Car Dials → Brake pressure bias',
  // Differential
  'Differential':              'Chassis → Rear section → Differential (scroll down in Chassis)',
  'Differential (Power / Drive Ramp)': 'Chassis → Rear section → Differential (scroll down in Chassis)',
  // Gearing
  'Gear Ratio (Final Drive)':  'Chassis → Rear section → Gear ratios (varies by car)',
  // Oval-specific
  'Nose Wedge / Left Rear Wedge': 'Chassis → Front/Brakes → Nose weight / Cross weight',
  'Rear Track Bar Height':     'Chassis → Rear section → Track bar height (oval cars)',
  // Driving advice
  'Throttle Technique':        '(Driving advice — no setup change needed)',
  'Braking Technique':         '(Driving advice — no setup change needed)',
};

export function getAdjustmentsForCategory(
  adjustments: SetupAdjustment[],
  category: CarCategory,
): SetupAdjustment[] {
  return adjustments.filter(a =>
    a.categories.length === 0 || a.categories.includes(category) || category === 'unknown',
  );
}
