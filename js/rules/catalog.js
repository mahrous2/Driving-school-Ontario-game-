/* Violation catalogue.
 * Each entry: title, sev (minor | major | critical), pts (deduction), rule (what you did wrong),
 * mto (what the Official MTO Driver's Handbook teaches, paraphrased), hta (Highway Traffic Act reference), tip.
 * Text is paraphrased for training purposes — always defer to the current MTO Driver's Handbook and the HTA.
 */
(function () {
  'use strict';
  const DS = window.DS;

  const SEV = { minor: { label: 'Minor', color: '#f5c542' }, major: { label: 'Major', color: '#ff8a3d' }, critical: { label: 'Dangerous action — Automatic fail', color: '#ff4040' } };

  const V = {
    // ---------------- speed ----------------
    SPEED_MINOR: { title: 'Speeding (6–15 km/h over the limit)', sev: 'minor', pts: 5, rule: 'You exceeded the posted maximum speed.',
      mto: 'Obey the posted maximum speed. If no limit is posted, it is 50 km/h in cities, towns and villages and 80 km/h elsewhere. Examiners deduct marks for any speed above the limit.', hta: 'HTA s.128', tip: 'Glance at your speedometer every 5–8 seconds, and ease off before the limit changes.' },
    SPEED_MAJOR: { title: 'Speeding (16–30 km/h over the limit)', sev: 'major', pts: 10, rule: 'You were well over the posted maximum speed.',
      mto: 'Speed limits are maximums for ideal conditions. Driving well over the limit reduces the time you have to react and greatly increases stopping distance.', hta: 'HTA s.128', tip: 'Lift off the accelerator early. Use engine braking on downgrades.' },
    SPEED_CRIT: { title: 'Excessive speed (more than 30 km/h over)', sev: 'critical', pts: 25, rule: 'Driving far over the limit is a dangerous action that ends a road test.',
      mto: 'Driving 40 km/h or more over the limit can lead to roadside licence suspension and vehicle impoundment (50+ over on roads posted 80 km/h or more is stunt driving).', hta: 'HTA s.128 / s.172', tip: 'Slow down. On a road test, excessive speed is an automatic fail.' },
    SCHOOL_ZONE_SPEED: { title: 'Speeding in a school zone', sev: 'major', pts: 15, rule: 'You passed through an active (flashing) school zone above the reduced limit.',
      mto: 'Watch for school zone signs. When the amber beacons are flashing the reduced limit (often 40 km/h) applies. Children may dart out without warning.', hta: 'HTA s.128', tip: 'Slow to the school-zone limit before the first sign and scan both sidewalks.' },
    WINTER_SPEED: { title: 'Too fast for winter conditions', sev: 'minor', pts: 5, rule: 'The limit is for ideal conditions. On snow and ice you must drive slower.',
      mto: 'In winter, slow down, double your following distance and brake gently. Speed limits are for dry, clear roads.', hta: 'HTA s.130 (careless driving)', tip: 'Drive 10–20 km/h under the limit on snow-covered roads.' },
    SLOW_DRIVING: { title: 'Driving too slowly on the highway', sev: 'minor', pts: 3, rule: 'Driving far below the flow of traffic without reason blocks traffic.',
      mto: 'Do not drive so slowly that you block the normal movement of traffic. If you must drive slowly, use the right-most lane.', hta: 'HTA s.132', tip: 'Match the flow of traffic, staying at or below the limit.' },

    // ---------------- stop signs ----------------
    STOP_NONE: { title: 'Failed to stop at a stop sign', sev: 'critical', pts: 25, rule: 'You drove through a stop sign without stopping.',
      mto: 'At a stop sign you must come to a complete stop at the stop line. If there is no stop line, stop at the crosswalk; if there is no crosswalk, stop at the edge of the intersection.', hta: 'HTA s.136(1)', tip: 'Brake early and smoothly. Your wheels must stop turning completely.' },
    STOP_ROLLING: { title: 'Incomplete (rolling) stop', sev: 'major', pts: 10, rule: 'Your vehicle never came to a complete stop.',
      mto: 'A stop means the vehicle is completely stationary. Slowing down and rolling through is not a stop.', hta: 'HTA s.136(1)', tip: 'Feel the car settle back, then count "one-thousand-one" before moving.' },
    STOP_PAST_LINE: { title: 'Stopped past the stop line', sev: 'minor', pts: 3, rule: 'You stopped over the stop line or inside the crosswalk.',
      mto: 'Stop before the stop line so pedestrians can use the crosswalk. If you can not see, creep forward slowly after stopping.', hta: 'HTA s.136(1)(a)', tip: 'Line up your mirrors with the stop line.' },
    ALLWAY_YIELD: { title: 'Failed to yield at an all-way stop', sev: 'major', pts: 15, rule: 'Another vehicle had the right-of-way and you went first.',
      mto: 'At an all-way stop the first vehicle to stop is the first to go. If two vehicles stop at the same time, the driver on the left yields to the driver on the right.', hta: 'HTA s.135 / s.136', tip: 'Remember the order you arrived in. When in doubt, yield.' },
    STOP_YIELD: { title: 'Failed to yield after stopping', sev: 'major', pts: 15, rule: 'You pulled out from a stop sign into the path of cross traffic.',
      mto: 'After stopping, yield the right-of-way to traffic in the intersection or approaching so closely that it is a hazard.', hta: 'HTA s.136(1)(b)', tip: 'Look left, right, then left again before pulling out.' },
    HESITATION: { title: 'Hesitation — did not proceed when it was your turn', sev: 'minor', pts: 2, rule: 'It was your turn and the way was clear, but you waited too long.',
      mto: 'Drive confidently. Unnecessary hesitation confuses other drivers who are trying to determine who has the right-of-way.', hta: '—', tip: 'Once it is your turn and the intersection is clear, go.' },

    // ---------------- signals ----------------
    RED_LIGHT: { title: 'Ran a red light', sev: 'critical', pts: 25, rule: 'You entered the intersection on a red light.',
      mto: 'A red light means stop at the stop line (or crosswalk) and wait until it turns green.', hta: 'HTA s.144(18)', tip: 'Anticipate "stale" greens and be ready to stop.' },
    AMBER: { title: 'Entered on amber when you could have stopped', sev: 'minor', pts: 5, rule: 'The light turned amber far enough ahead for you to stop safely.',
      mto: 'An amber light means stop if you can do so safely; otherwise proceed with caution.', hta: 'HTA s.144(15)', tip: 'Identify your "point of no return" as you approach a light.' },
    RTOR_BANNED: { title: 'Right turn on red where prohibited', sev: 'critical', pts: 25, rule: 'A "No Right Turn on Red" sign was posted at this approach.',
      mto: 'You may turn right on a red light after a complete stop — unless a sign prohibits it.', hta: 'HTA s.144', tip: 'Scan for signs on the far side of the intersection and overhead.' },
    RTOR_NOSTOP: { title: 'Right on red without a complete stop', sev: 'critical', pts: 25, rule: 'You turned right on red without stopping first.',
      mto: 'Before turning right on a red light you must come to a complete stop and yield to pedestrians and traffic.', hta: 'HTA s.144', tip: 'Stop fully behind the line, then check left, right, left and your right blind spot.' },
    RTOR_SHORT: { title: 'Stop too brief before right on red (3-second standard)', sev: 'minor', pts: 3, rule: 'The law requires a complete stop; Ontario road-test standard is a full stop of about 3 seconds so you can scan properly.',
      mto: 'Stop completely, then check for pedestrians, cyclists and traffic from the left before turning. Take your time.', hta: 'HTA s.144', tip: 'Count three seconds while you scan left-right-left.' },
    RTOR_YIELD: { title: 'Failed to yield turning right on red', sev: 'major', pts: 15, rule: 'You turned right on red into the path of traffic or pedestrians.',
      mto: 'When turning right on red, traffic with the green light and pedestrians have the right-of-way.', hta: 'HTA s.144', tip: 'Wait for a gap big enough to reach the speed of traffic.' },
    LEFT_YIELD: { title: 'Failed to yield on a left turn', sev: 'critical', pts: 25, rule: 'You turned left in front of oncoming traffic.',
      mto: 'When turning left on a green light, yield to oncoming traffic and pedestrians. Wait in the intersection with your wheels straight until it is safe.', hta: 'HTA s.141(5)', tip: 'Keep wheels straight while waiting so a rear-end crash will not push you into traffic.' },

    // ---------------- pedestrians & crossings ----------------
    PED_YIELD: { title: 'Failed to yield to a pedestrian', sev: 'critical', pts: 25, rule: 'A pedestrian was in the crosswalk in your path.',
      mto: 'When turning at an intersection you must yield to pedestrians crossing. Wait until they are safely out of your path.', hta: 'HTA s.144(7)', tip: 'Check the crosswalk you are turning into before you start the turn.' },
    PXO: { title: 'Did not stop for a pedestrian crossover', sev: 'critical', pts: 25, rule: 'A pedestrian was on the crossover and you drove through.',
      mto: 'At a pedestrian crossover you must stop and wait until the pedestrian has COMPLETELY crossed the road, not just your half.', hta: 'HTA s.140(1)', tip: 'Watch for the overhead X signs and flashing amber beacons.' },
    GUARD: { title: 'Did not stop for a school crossing guard', sev: 'critical', pts: 25, rule: 'The crossing guard was displaying a STOP sign.',
      mto: 'Stop for a school crossing guard displaying a stop sign and wait until all people, including the guard, have left the roadway.', hta: 'HTA s.176(3)', tip: 'Slow down when you see a crossing guard on the curb.' },
    SCHOOL_BUS_PASS: { title: 'Passed a stopped school bus', sev: 'critical', pts: 25, rule: 'The bus had its red lights flashing and stop arm out.',
      mto: 'Vehicles in BOTH directions must stop for a school bus with flashing red lights, unless the road is divided by a physical median. Stay stopped until the bus moves or the lights stop flashing.', hta: 'HTA s.175(11)', tip: 'Amber lights flashing means the bus is about to stop — prepare to stop.' },
    SCHOOL_BUS_CLOSE: { title: 'Stopped too close to a school bus', sev: 'major', pts: 10, rule: 'Approaching from behind, you must stop at least 20 m from the bus.',
      mto: 'When coming from behind a school bus with red lights flashing, stop at least 20 metres away. From the front, stop at a safe distance so children can cross.', hta: 'HTA s.175(11)', tip: '20 m is about four car lengths.' },
    STREETCAR_DOORS: { title: 'Passed a streetcar with open doors', sev: 'critical', pts: 25, rule: 'Passengers were boarding or leaving the streetcar.',
      mto: 'When a streetcar stops to load or unload passengers, stop at least 2 m behind the rear doors and wait until the doors close and passengers have reached the curb.', hta: 'HTA s.166(1)', tip: 'Watch for streetcar stop signs on the poles at the curb.' },
    STREETCAR_LEFT: { title: 'Passed a streetcar on the left', sev: 'major', pts: 15, rule: 'You overtook a streetcar using the oncoming side.',
      mto: 'Do not pass a streetcar on the left, except on one-way streets.', hta: 'HTA s.166(2)', tip: 'Stay behind the streetcar or pass on the right when doors are closed.' },

    // ---------------- emergency vehicles ----------------
    EV_YIELD: { title: 'Did not pull over for an emergency vehicle', sev: 'critical', pts: 25, rule: 'An emergency vehicle with lights and siren was approaching.',
      mto: 'When an emergency vehicle approaches with flashing red/blue lights or siren, signal, pull to the right as far as safely possible, stop clear of intersections, and wait until it passes.', hta: 'HTA s.159(1)', tip: 'Check your mirrors often — you will usually hear the siren before you see it.' },
    MOVE_OVER: { title: 'Did not move over for a stopped emergency vehicle', sev: 'major', pts: 15, rule: 'An emergency vehicle was stopped on the shoulder with lights flashing and the next lane was clear.',
      mto: 'When you approach a stopped emergency vehicle or tow truck with flashing lights, slow down and pass with caution. On multi-lane roads, move over into the next lane if it is safe.', hta: 'HTA s.159(2)–(3)', tip: 'Plan the lane change early — check your mirror and left blind spot.' },
    MOVE_OVER_SLOW: { title: 'Did not slow down for a stopped emergency vehicle', sev: 'major', pts: 15, rule: 'You stayed beside the stopped vehicle at highway speed.',
      mto: 'If you can not move over safely, you must slow down and proceed with caution past the stopped emergency vehicle.', hta: 'HTA s.159(2)', tip: 'Drop well below the limit if you can not change lanes.' },

    // ---------------- signals / observation ----------------
    SIGNAL_TURN: { title: 'No turn signal', sev: 'minor', pts: 5, rule: 'You turned without signalling your intention.',
      mto: 'Signal before every turn, well in advance, so other road users know what you intend to do.', hta: 'HTA s.142(1)', tip: 'Signal about 30 m before the intersection (after any closer side street).' },
    SIGNAL_WRONG: { title: 'Wrong turn signal', sev: 'major', pts: 10, rule: 'Your signal indicated the opposite direction.',
      mto: 'A wrong signal misleads other drivers and pedestrians and can cause a collision.', hta: 'HTA s.142(1)', tip: 'Q = left, E = right.' },
    SIGNAL_LANE: { title: 'No signal for lane change', sev: 'minor', pts: 5, rule: 'You changed lanes without signalling.',
      mto: 'Signal every lane change. Check your mirrors and blind spot, signal, then move over smoothly.', hta: 'HTA s.142(1)', tip: 'Signal for about 3 blinks before moving.' },
    SIGNAL_LEFT_ON: { title: 'Signal left on after manoeuvre', sev: 'minor', pts: 2, rule: 'Your turn signal stayed on after you finished.',
      mto: 'Cancel your signal after turning or changing lanes so you do not mislead others.', hta: 'HTA s.142', tip: 'After a lane change the signal does not cancel itself.' },
    MIRROR_LANE: { title: 'No mirror check before lane change', sev: 'minor', pts: 3, rule: 'You did not check your mirrors before moving over.',
      mto: 'Before changing lanes check your inside and outside mirrors for traffic behind and beside you.', hta: 'HTA s.154(1)(a)', tip: 'Press X to check mirrors.' },
    SHOULDER_LANE: { title: 'No blind-spot (shoulder) check', sev: 'minor', pts: 5, rule: 'You did not look over your shoulder before moving sideways.',
      mto: 'Mirrors do not show your blind spots. Always do a quick shoulder check in the direction you are moving.', hta: 'HTA s.154(1)(a)', tip: 'Z = left shoulder check, C = right shoulder check.' },
    UNSAFE_LANE: { title: 'Unsafe lane change', sev: 'major', pts: 15, rule: 'There was not enough space in the lane you moved into.',
      mto: 'Do not change lanes until you can do so safely. Leave room in front and behind — the vehicle behind should not have to brake.', hta: 'HTA s.154(1)(a)', tip: 'You should see the headlights of the car you passed in your inside mirror before moving back.' },
    CUT_OFF: { title: 'Forced another driver to brake hard', sev: 'major', pts: 15, rule: 'Your manoeuvre made another vehicle brake sharply — a failure to yield.',
      mto: 'Yield the right-of-way whenever another driver would otherwise have to brake or swerve to avoid you.', hta: 'HTA s.154 / s.141', tip: 'Judge gaps by time, not distance — larger gaps at higher speeds.' },
    FOLLOW: { title: 'Following too closely', sev: 'minor', pts: 5, rule: 'Your time gap to the vehicle ahead was below the 3-second standard.',
      mto: 'Keep at least a two-second gap in ideal conditions — Ontario road tests expect three seconds or more — and double it in rain, snow or ice.', hta: 'HTA s.158(1)', tip: 'Pick a fixed object; count seconds from when the car ahead passes it.' },
    TAILGATE: { title: 'Tailgating (under 1.5 s)', sev: 'major', pts: 10, rule: 'Your gap was far too small to stop if the vehicle ahead braked.',
      mto: 'A driver must not follow another vehicle more closely than is reasonable and prudent, considering speed, traffic and road conditions.', hta: 'HTA s.158(1)', tip: 'Ease off and let the gap grow.' },
    KEEP_RIGHT: { title: 'Keep right except to pass', sev: 'minor', pts: 3, rule: 'You stayed in the left lane without passing anyone.',
      mto: 'On multi-lane highways, keep right except when passing. Slower traffic uses the right lane.', hta: 'HTA s.147(1)', tip: 'Return to the right once you can see the passed car in your inside mirror.' },
    LEFT_OF_CENTRE: { title: 'Driving left of centre', sev: 'major', pts: 15, rule: 'You drove on the wrong side of the centre line.',
      mto: 'Keep to the right of the centre line. Cross it only to pass when it is safe and permitted.', hta: 'HTA s.148', tip: 'Aim far down your lane to stay centred.' },
    WRONG_WAY: { title: 'Wrong way on a one-way street', sev: 'critical', pts: 25, rule: 'You travelled against the direction of a one-way street.',
      mto: 'Watch for ONE WAY signs and drive only in the direction shown.', hta: 'HTA s.153', tip: 'Parked cars and signs facing away from you are clues.' },

    // ---------------- highway ----------------
    MERGE_SHOULDER: { title: 'No shoulder check when merging', sev: 'major', pts: 10, rule: 'You merged onto the highway without checking your left blind spot.',
      mto: 'On the acceleration lane: signal, check your mirrors AND your blind spot over your left shoulder, then merge into a safe gap.', hta: 'HTA s.154(1)(a)', tip: 'Press Z during the acceleration lane.' },
    MERGE_SLOW: { title: 'Merged too slowly', sev: 'minor', pts: 5, rule: 'You merged well below the speed of highway traffic.',
      mto: 'Use the acceleration lane to bring your speed up to that of highway traffic before merging. Do not stop unless absolutely necessary.', hta: '—', tip: 'Accelerate firmly on the ramp: aim for 90–100 km/h at the merge.' },
    MERGE_SIGNAL: { title: 'No signal when merging', sev: 'minor', pts: 5, rule: 'You merged onto the highway without signalling left.',
      mto: 'Signal your intention to merge as you travel along the acceleration lane.', hta: 'HTA s.142(1)', tip: 'Q = left signal.' },
    ACCEL_END: { title: 'Ran out of acceleration lane', sev: 'major', pts: 15, rule: 'You reached the end of the acceleration lane without merging.',
      mto: 'Plan your merge early. Adjust your speed to fit into a gap well before the lane ends.', hta: '—', tip: 'Look over your shoulder early so you can pick a gap.' },
    GORE: { title: 'Crossed a solid line / painted gore', sev: 'major', pts: 10, rule: 'You crossed the painted area that separates ramp and highway.',
      mto: 'Do not cross solid lines or painted islands at ramps. Enter and leave the highway only where the lane lines are broken.', hta: '—', tip: 'Commit to your exit early; if you miss it, take the next one.' },
    EXIT_SLOW: { title: 'Slowed down in a through lane before the exit', sev: 'minor', pts: 5, rule: 'You braked on the highway instead of in the deceleration lane.',
      mto: 'Signal, move into the deceleration lane, and only then slow down to the ramp speed.', hta: '—', tip: 'Maintain highway speed until you are fully in the exit lane.' },
    REVERSE_HWY: { title: 'Backing up on a highway', sev: 'critical', pts: 25, rule: 'You reversed on a high-speed highway.',
      mto: 'Never back up on a freeway, ramp or shoulder. If you miss an exit, continue to the next one.', hta: 'HTA s.157(1)', tip: 'Missed exit? Take the next one.' },
    HAZARDS_SHOULDER: { title: 'No hazard lights while stopped on the shoulder', sev: 'minor', pts: 3, rule: 'Stopped on a highway shoulder without hazard lights.',
      mto: 'If you must stop on the shoulder, pull well off the road and turn on your hazard lights.', hta: '—', tip: 'H = hazard lights.' },

    // ---------------- roundabouts ----------------
    ROUNDABOUT_YIELD: { title: 'Failed to yield entering a roundabout', sev: 'major', pts: 15, rule: 'Traffic already circulating had the right-of-way.',
      mto: 'When entering a roundabout, yield to traffic already in it (coming from your left). Enter when there is a safe gap.', hta: 'HTA s.138 (yield sign)', tip: 'Slow down well before the yield line; look left.' },
    ROUNDABOUT_WRONG: { title: 'Wrong way in a roundabout', sev: 'critical', pts: 25, rule: 'Traffic in a roundabout travels counter-clockwise.',
      mto: 'Always travel counter-clockwise in a roundabout, keeping the central island on your left.', hta: 'HTA s.153', tip: 'Turn RIGHT to enter.' },
    ROUNDABOUT_SIGNAL: { title: 'No right signal leaving the roundabout', sev: 'minor', pts: 3, rule: 'You exited without signalling right.',
      mto: 'Signal right as you pass the exit before the one you want to take.', hta: 'HTA s.142(1)', tip: 'E = right signal.' },
    ROUNDABOUT_SPEED: { title: 'Too fast in the roundabout', sev: 'minor', pts: 3, rule: 'Roundabouts are designed for about 30 km/h.',
      mto: 'Slow down when approaching and travelling through a roundabout, and watch for pedestrians and cyclists.', hta: 'HTA s.130', tip: 'Brake before the yield line, not inside the circle.' },

    // ---------------- cyclists ----------------
    BIKE_SHOULDER: { title: 'No right shoulder check for cyclists', sev: 'minor', pts: 5, rule: 'You turned right across a bike lane without checking your right blind spot.',
      mto: 'Before a right turn, check your mirror and over your right shoulder for cyclists coming up beside you. Yield to cyclists in the bike lane.', hta: '—', tip: 'C = right shoulder check.' },
    BIKE_YIELD: { title: 'Cut off a cyclist', sev: 'major', pts: 15, rule: 'A cyclist in the bike lane was beside or close behind you as you turned.',
      mto: 'Cyclists in bike lanes have the right-of-way. Let them pass before you turn right across the bike lane.', hta: 'HTA s.141', tip: 'Slow down and let the cyclist go first.' },
    BIKE_LANE: { title: 'Driving in the bike lane', sev: 'minor', pts: 5, rule: 'Motor vehicles may not drive in a bike lane except briefly to turn.',
      mto: 'Do not drive or park in a bike lane. Enter it only to turn right after yielding to cyclists.', hta: 'Municipal by-law', tip: 'Stay left of the solid white bike-lane line.' },

    // ---------------- control / collisions ----------------
    COLLISION_VEH: { title: 'Collision with a vehicle', sev: 'critical', pts: 30, rule: 'You collided with another vehicle.',
      mto: 'Drive defensively: scan 12–15 seconds ahead, keep space around your vehicle, and always have an escape route.', hta: 'HTA s.130', tip: 'Increase following distance and check blind spots.' },
    COLLISION_PED: { title: 'Struck a pedestrian or cyclist', sev: 'critical', pts: 40, rule: 'You hit a vulnerable road user.',
      mto: 'Pedestrians and cyclists are the most vulnerable road users. Be prepared to stop for them at all times.', hta: 'HTA s.130', tip: 'Slow down near crosswalks, stops and parked cars.' },
    COLLISION_OBJ: { title: 'Struck a fixed object', sev: 'critical', pts: 25, rule: 'You hit a building, pole or barrier.',
      mto: 'Maintain control of your vehicle at all times and drive at a speed that lets you stop safely.', hta: 'HTA s.130', tip: 'Slow down for tight turns.' },
    CURB: { title: 'Mounted the curb', sev: 'major', pts: 10, rule: 'Your wheels went up onto the curb or sidewalk.',
      mto: 'When turning, keep your vehicle in its lane; for right turns stay close to — but not over — the curb.', hta: '—', tip: 'Start the right turn when your front wheels reach the crosswalk.' },
    OFFROAD: { title: 'Drove off the roadway', sev: 'major', pts: 10, rule: 'Your vehicle left the road surface.',
      mto: 'Stay within your lane. If you drop a wheel off the pavement, ease off the gas and steer back gently.', hta: 'HTA s.130', tip: 'Look where you want to go.' },
    SKID: { title: 'Loss of control (skid)', sev: 'minor', pts: 5, rule: 'You braked or steered too hard for the available grip and the car slid.',
      mto: 'On slippery roads brake gently and early. In a skid, ease off the brake, look and steer where you want to go.', hta: 'HTA s.130', tip: 'Do not brake and turn hard at the same time on ice.' },

    // ---------------- vehicle / start / park ----------------
    SEATBELT: { title: 'Driving without a seatbelt', sev: 'major', pts: 15, rule: 'You drove away without fastening your seatbelt.',
      mto: 'The driver must wear a properly adjusted seatbelt. Fasten it before starting to drive.', hta: 'HTA s.106(2)', tip: 'Press B to fasten your seatbelt.' },
    HEADLIGHTS: { title: 'Headlights off when required', sev: 'minor', pts: 5, rule: 'Visibility was reduced (night, rain or snow) and your headlights were off.',
      mto: 'Use headlights from half an hour before sunset to half an hour after sunrise, and whenever you can not see people and vehicles clearly 150 m away.', hta: 'HTA s.62(1)', tip: 'Press L for headlights.' },
    PULL_OUT_SIGNAL: { title: 'No signal leaving the curb', sev: 'minor', pts: 3, rule: 'You pulled out from a parked position without signalling.',
      mto: 'Before moving away from the curb, check mirrors and blind spot, signal, and wait for a safe gap.', hta: 'HTA s.142(1)', tip: 'Left signal (Q) before pulling out.' },
    PULL_OUT_CHECK: { title: 'No blind-spot check leaving the curb', sev: 'minor', pts: 5, rule: 'You pulled out without checking over your left shoulder.',
      mto: 'Always shoulder check before pulling out from a parked position — your mirrors will not show a vehicle beside you.', hta: 'HTA s.142', tip: 'Z = left shoulder check.' },
    PARK_SIGNAL: { title: 'No signal when pulling over', sev: 'minor', pts: 3, rule: 'You pulled over to the curb without signalling right.',
      mto: 'Signal and check your mirrors and right blind spot before pulling over to the curb.', hta: 'HTA s.142(1)', tip: 'E = right signal.' },
    PARK_CHECK: { title: 'No right blind-spot check when pulling over', sev: 'minor', pts: 3, rule: 'You moved right without a shoulder check.',
      mto: 'Cyclists often ride along the curb — shoulder check right before moving over.', hta: '—', tip: 'C = right shoulder check.' },
    PARK_FAR: { title: 'Parked too far from the curb', sev: 'minor', pts: 3, rule: 'You stopped more than about 50 cm from the curb.',
      mto: 'When parking at the curb, stop parallel to it and close to it (within about 30–50 cm).', hta: '—', tip: 'Watch the curb line in the top-down view while you learn the reference points.' },
  };

  DS.SEV = SEV;
  DS.VIOLATIONS = V;
})();
