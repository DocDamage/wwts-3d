import json, os

# Regenerates public/models/animations/manifest.json from the downloaded Mixamo clips
DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'models', 'animations')
OUT = os.path.join(DIR, 'manifest.json')
files = sorted(f[:-4] for f in os.listdir(DIR) if f.endswith('.fbx'))

# id: (label, icon, category, loop, extra)
T = {
  # ---- base locomotion (driven by the controller, hidden from the move dock)
  'idle': ('Idle', '🧍', 'base', True, {}),
  'idle_look1': ('Look Around', '👀', 'base', True, {}),
  'idle_look2': ('Look Around 2', '👀', 'base', True, {}),
  'idle_weight_shift': ('Weight Shift', '🧍', 'base', True, {}),
  'idle_happy': ('Happy Idle', '😄', 'base', True, {}),
  'idle_neutral': ('Neutral Idle', '🧍', 'base', True, {}),
  'walk': ('Walk', '🚶', 'base', True, {'speed': 1.35}),
  'walk_back': ('Walk Back', '🔙', 'base', True, {'speed': 1.2}),
  'run': ('Run', '🏃', 'base', True, {'speed': 3.6}),
  'run_back': ('Run Back', '🔙', 'base', True, {'speed': 3.0}),
  'strafe_left': ('Strafe Left', '⬅️', 'base', True, {'speed': 1.2}),
  'strafe_right': ('Strafe Right', '➡️', 'base', True, {'speed': 1.2}),
  'walk_start': ('Start Walking', '🚶', 'base', False, {}),
  'walk_stop': ('Stop Walking', '🛑', 'base', False, {}),
  'run_stop': ('Run To Stop', '🛑', 'base', False, {}),
  'turn_left_90': ('Turn Left', '↪️', 'base', False, {}),
  'turn_right_90': ('Turn Right', '↩️', 'base', False, {}),
  'turn_left_180': ('Turn Around', '🔄', 'base', False, {}),
  'turn_right_180': ('Turn Around', '🔄', 'base', False, {}),
  'walk_turn_180': ('Walking U-Turn', '🔄', 'base', False, {}),
  'run_turn_180': ('Running U-Turn', '🔄', 'base', False, {}),
  'walk_turn_left': ('Walking Turn Left', '↪️', 'base', False, {}),
  'walk_turn_right': ('Walking Turn Right', '↩️', 'base', False, {}),
  'fight_idle': ('Boxing Bounce', '🥊', 'base', True, {}),
  'fight_stance': ('Fight Stance', '🥊', 'base', True, {}),
  'fight_mma_idle': ('MMA Stance', '🥋', 'base', True, {}),
  'fight_step_forward': ('Step In', '⏩', 'base', False, {}),
  'fight_step_back': ('Step Back', '⏪', 'base', False, {}),
  'fight_sidestep_left': ('Side Step L', '⬅️', 'base', False, {}),
  'fight_sidestep_right': ('Side Step R', '➡️', 'base', False, {}),
  'falling_idle': ('Falling', '🪂', 'base', True, {}),

  # ---- dances
  'dance_side_to_side': ('Side To Side', '🕺', 'dance', True, {}),
  'dance_step': ('Step Dance', '👟', 'dance', True, {}),
  'dance_running_man': ('Running Man', '🏃', 'dance', True, {}),
  'dance_uprock': ('Uprock', '🤸', 'dance', True, {}),
  'dance_shimmy': ('Shimmy', '💃', 'dance', True, {}),
  'dance_locking': ('Locking', '🔒', 'dance', True, {}),
  'dance_wave': ('Arm Wave', '🌊', 'dance', True, {}),
  'dance_tut': ('Tutting', '📐', 'dance', True, {}),
  'dance_robot': ('Robot', '🤖', 'dance', True, {}),
  'dance_moonwalk': ('Moonwalk', '🌙', 'dance', True, {}),

  # ---- breaking
  'break_ready': ('Ready Up', '🧢', 'breaking', False, {}),
  'break_brooklyn_uprock': ('Brooklyn Rock', '🗽', 'breaking', True, {}),
  'break_indian_step': ('Indian Step', '🦶', 'breaking', True, {}),
  'break_uprock_to_ground': ('Drop Down', '⬇️', 'breaking', False, {'then': 'break_footwork1'}),
  'break_footwork1': ('Footwork', '🌀', 'breaking', True, {}),
  'break_footwork2': ('Footwork 2', '🌀', 'breaking', True, {}),
  'break_footwork3': ('Footwork 3', '🌀', 'breaking', True, {}),
  'break_footwork_to_freeze': ('Into Freeze', '🧊', 'breaking', False, {}),
  'break_footwork_to_idle': ('Back Up', '⬆️', 'breaking', False, {}),
  'break_flair': ('Flair', '🌪️', 'breaking', True, {}),
  'break_headspin': ('Headspin', '🙃', 'breaking', True, {}),
  'break_1990': ('1990 Spin', '✋', 'breaking', True, {}),
  'break_freezes': ('Freeze Combo', '🧊', 'breaking', False, {}),
  'break_freeze_handstand': ('Handstand Freeze', '🤸', 'breaking', False, {}),
  'break_swipes': ('Swipes', '💫', 'breaking', False, {}),
  'break_ending': ('Finisher', '🏁', 'breaking', False, {}),
  'bboy_pose_to_idle': ('B-Boy Pose', '😎', 'breaking', False, {}),

  # ---- attacks (power 1 light .. 3 heavy, reach in metres between hips)
  'fight_jab': ('Jab', '👊', 'fight', False, {'power': 1, 'reach': 0.95}),
  'fight_jab_head': ('Head Jab', '👊', 'fight', False, {'power': 1, 'reach': 0.95}),
  'fight_cross': ('Cross', '🥊', 'fight', False, {'power': 2, 'reach': 0.95}),
  'fight_jab_cross': ('Jab Cross', '🥊', 'fight', False, {'power': 2, 'reach': 0.95}),
  'fight_hook_lead': ('Lead Hook', '🥊', 'fight', False, {'power': 2, 'reach': 0.85}),
  'fight_hook_back': ('Rear Hook', '🥊', 'fight', False, {'power': 2, 'reach': 0.85}),
  'fight_hook_short': ('Short Hook', '🥊', 'fight', False, {'power': 2, 'reach': 0.8}),
  'fight_hook_body': ('Body Hook', '🥊', 'fight', False, {'power': 2, 'reach': 0.8, 'body': True}),
  'fight_uppercut': ('Uppercut', '⬆️', 'fight', False, {'power': 3, 'reach': 0.8}),
  'fight_uppercut_lead': ('Lead Uppercut', '⬆️', 'fight', False, {'power': 3, 'reach': 0.8}),
  'fight_uppercut_back': ('Rear Uppercut', '⬆️', 'fight', False, {'power': 3, 'reach': 0.8}),
  'fight_combo4': ('4-Hit Combo', '💥', 'fight', False, {'power': 2, 'reach': 0.95}),
  'fight_combo8': ('8-Hit Combo', '💥', 'fight', False, {'power': 2, 'reach': 0.95}),
  'fight_elbow': ('Elbow', '💪', 'fight', False, {'power': 2, 'reach': 0.7}),
  'fight_knee': ('Knee Strike', '🦵', 'fight', False, {'power': 2, 'reach': 0.75, 'body': True}),
  'fight_headbutt': ('Headbutt', '🤕', 'fight', False, {'power': 2, 'reach': 0.75}),
  'fight_knees_uppercut': ('Knees + Uppercut', '💥', 'fight', False, {'power': 3, 'reach': 0.8}),
  'fight_backflip_uppercut': ('Backflip Uppercut', '🔥', 'fight', False, {'power': 3, 'reach': 0.9}),
  'fight_kick_low': ('Low Kick', '🦶', 'fight', False, {'power': 1, 'reach': 1.1, 'body': True}),
  'fight_kick_side': ('Side Kick', '🦶', 'fight', False, {'power': 2, 'reach': 1.2, 'body': True}),
  'fight_kick_roundhouse': ('Roundhouse', '🦶', 'fight', False, {'power': 2, 'reach': 1.15}),
  'fight_kick_high': ('High Kick', '🦶', 'fight', False, {'power': 3, 'reach': 1.15}),
  'fight_kick_spin_back': ('Spinning Back Kick', '🌪️', 'fight', False, {'power': 3, 'reach': 1.15}),
  'fight_flip_kick': ('Flip Kick', '🤸', 'fight', False, {'power': 3, 'reach': 1.1}),
  'fight_spin_flip_kick': ('Spin Flip Kick', '🌪️', 'fight', False, {'power': 3, 'reach': 1.2}),
  'fight_bicycle_kick': ('Bicycle Kick', '🚲', 'fight', False, {'power': 3, 'reach': 1.1}),
  'fight_drop_kick': ('Drop Kick', '🦶', 'fight', False, {'power': 3, 'reach': 1.2}),
  'fight_hurricane_kick': ('Hurricane Kick', '🌀', 'fight', False, {'power': 3, 'reach': 1.1}),
  'fight_flying_knee': ('Flying Knee', '🦵', 'fight', False, {'power': 3, 'reach': 1.1}),
  'fight_armada': ('Armada', '🌪️', 'fight', False, {'power': 2, 'reach': 1.15}),
  'fight_meia_lua': ('Meia Lua', '🌙', 'fight', False, {'power': 2, 'reach': 1.15}),
  'fight_hadouken': ('Fireball', '🔥', 'fight', False, {'power': 3, 'reach': 3.0, 'projectile': True}),
  'fight_grab_slam': ('Grab & Slam', '🤼', 'fight', False, {'power': 3, 'reach': 0.7}),
  # paired moves (played together by the fight director)
  'fight_throw_attacker': ('Shoulder Throw', '🤼', 'paired', False, {'pair': 'fight_throw_victim'}),
  'fight_throw_victim': ('Thrown', '🤼', 'paired', False, {'then': 'getup_back'}),
  'fight_takedown_attacker': ('Takedown', '🤼', 'paired', False, {'pair': 'fight_takedown_victim'}),
  'fight_takedown_victim': ('Taken Down', '🤼', 'paired', False, {'then': 'getup_back'}),
  'fight_surprise_uppercut_attacker': ('Chase Uppercut', '⬆️', 'paired', False, {'pair': 'fight_surprise_uppercut_victim'}),
  'fight_surprise_uppercut_victim': ('Uppercut Victim', '⬆️', 'paired', False, {'then': 'getup_back'}),

  # ---- defence
  'fight_block': ('Block', '🛡️', 'defend', False, {}),
  'fight_block_high': ('High Block', '🛡️', 'defend', False, {}),
  'fdodge_advance': ('Slip In', '↗️', 'defend', False, {}),
  'fdodge_retreat': ('Slip Back', '↙️', 'defend', False, {}),
  'fdodge_jump_back': ('Jump Back', '⤴️', 'defend', False, {}),
  'fdodge_right': ('Dodge Right', '➡️', 'defend', False, {}),
  'fdodge_duck': ('Duck', '⬇️', 'defend', False, {}),
  'fdodge_corkscrew': ('Corkscrew Evade', '🌀', 'defend', False, {}),
  'fdodge_aerial': ('Aerial Evade', '🦅', 'defend', False, {}),

  # ---- hit reactions
  'fhit_head_light_l': ('Light Hit L', '😖', 'react', False, {'hit': 'head', 'size': 1, 'side': 'l'}),
  'fhit_head_light_r': ('Light Hit R', '😖', 'react', False, {'hit': 'head', 'size': 1, 'side': 'r'}),
  'fhit_head_light_c': ('Light Hit', '😖', 'react', False, {'hit': 'head', 'size': 1, 'side': 'c'}),
  'fhit_head_med_l': ('Hit L', '😣', 'react', False, {'hit': 'head', 'size': 2, 'side': 'l'}),
  'fhit_head_med_r': ('Hit R', '😣', 'react', False, {'hit': 'head', 'size': 2, 'side': 'r'}),
  'fhit_head_med_c': ('Hit', '😣', 'react', False, {'hit': 'head', 'size': 2, 'side': 'c'}),
  'fhit_head_big_l': ('Big Hit L', '😵', 'react', False, {'hit': 'head', 'size': 3, 'side': 'l'}),
  'fhit_head_big_r': ('Big Hit R', '😵', 'react', False, {'hit': 'head', 'size': 3, 'side': 'r'}),
  'fhit_head_big_c': ('Big Hit', '😵', 'react', False, {'hit': 'head', 'size': 3, 'side': 'c'}),
  'fhit_stomach': ('Gut Shot', '🤢', 'react', False, {'hit': 'body', 'size': 2}),
  'fhit_stomach_big': ('Big Gut Shot', '🤮', 'react', False, {'hit': 'body', 'size': 3}),
  'fhit_body_uppercut': ('Body Uppercut Hit', '😫', 'react', False, {'hit': 'body', 'size': 2}),
  'fhit_body_straight': ('Body Hit', '😫', 'react', False, {'hit': 'body', 'size': 1}),
  'fhit_small_front': ('Flinch', '😬', 'react', False, {'hit': 'head', 'size': 1, 'side': 'c'}),
  'fhit_small_back': ('Hit From Behind', '😬', 'react', False, {}),
  'fight_hit_left': ('Hit From Left', '😖', 'react', False, {'hit': 'head', 'size': 2, 'side': 'l'}),
  'fight_hit_right': ('Hit From Right', '😖', 'react', False, {'hit': 'head', 'size': 2, 'side': 'r'}),
  'fight_hit_front': ('Knocked Back', '😵', 'react', False, {'hit': 'head', 'size': 3, 'side': 'c'}),
  'fight_recv_uppercut': ('Rocked', '😵', 'react', False, {'hit': 'head', 'size': 3, 'side': 'c'}),
  'fight_dizzy': ('Dizzy', '😵‍💫', 'react', True, {}),

  # ---- falls & knockouts (end on the floor → get up)
  'fall_down': ('Fall Down', '⬇️', 'falls', False, {'then': 'getup_back', 'floor': True}),
  'fall_flat': ('Face Plant', '🤕', 'falls', False, {'then': 'getup_stomach', 'floor': True}),
  'sweep_fall': ('Swept', '🦵', 'falls', False, {'then': 'getup_back', 'floor': True}),
  'knocked_down': ('Knocked Down', '💫', 'falls', False, {'then': 'getup_stomach', 'floor': True}),
  'fight_knockdown': ('Knockdown', '💫', 'falls', False, {'then': 'getup_knockdown', 'floor': True}),
  'fight_ko': ('Big Uppercut Hit', '😵', 'falls', False, {}),
  'fko_fall_back': ('KO Backward', '☠️', 'falls', False, {'then': 'getup_back', 'floor': True, 'ko': True}),
  'fko_fall_forward': ('KO Forward', '☠️', 'falls', False, {'then': 'getup_stomach', 'floor': True, 'ko': True}),
  'fko_flying_back': ('KO Flying', '☠️', 'falls', False, {'then': 'getup_back', 'floor': True, 'ko': True}),
  'fko_knee': ('KO To Knees', '☠️', 'falls', False, {'then': 'getup_stomach', 'floor': True, 'ko': True}),
  'fight_thrown_side': ('Thrown Aside', '🤼', 'falls', False, {'then': 'getup_back', 'floor': True}),
  'fight_laying_hurt': ('Laying Hurt', '🤕', 'falls', True, {'floor': True}),
  'getup_back': ('Get Up (Back)', '⬆️', 'falls', False, {}),
  'getup_stomach': ('Get Up (Front)', '⬆️', 'falls', False, {}),
  'getup_knockdown': ('Get Up', '⬆️', 'falls', False, {}),

  # ---- jumps
  'jump': ('Jump', '⬆️', 'jumps', False, {}),
  'jump_running': ('Running Jump', '🏃', 'jumps', False, {}),
  'jump_joyful': ('Joy Jump', '🙌', 'jumps', False, {}),
  'falling_landing': ('Land', '⬇️', 'jumps', False, {}),
  'hard_landing': ('Hard Landing', '💥', 'jumps', False, {}),
  'landing': ('Superhero Land', '🦸', 'jumps', False, {}),

  # ---- taunts & results
  'fight_taunt': ('Boxing Taunt', '😤', 'taunt', False, {}),
  'fight_flex': ('Flex', '💪', 'taunt', False, {}),
  'fight_threaten': ('Threaten', '😠', 'taunt', False, {}),
  'fight_loser_gesture': ('Loser!', '🫵', 'taunt', False, {}),
  'fight_victory': ('Victory', '🏆', 'taunt', False, {}),
  'fight_victory_boxing': ('Boxing Victory', '🥇', 'taunt', False, {}),
  'fight_defeat': ('Defeat', '😞', 'taunt', False, {}),

  # ---- second wave of fight moves
  'fight_kick_mid': ('Mid Kick', '🦶', 'fight', False, {'power': 2, 'reach': 1.15, 'body': True}),
  'fight_sweep_back': ('Back Sweep', '🧹', 'fight', False, {'power': 2, 'reach': 1.05, 'low': True, 'sweep': True}),
  'fight_sweep_360_back': ('360 Back Sweep', '🧹', 'fight', False, {'power': 2, 'reach': 1.05, 'low': True, 'sweep': True}),
  'fight_sweep_front': ('Front Sweep', '🧹', 'fight', False, {'power': 2, 'reach': 1.0, 'low': True, 'sweep': True}),
  'fight_sweep_360': ('360 Sweep Kick', '🧹', 'fight', False, {'power': 2, 'reach': 1.05, 'low': True, 'sweep': True}),
  'fight_flying_sidekick': ('Flying Side Kick', '🦅', 'fight', False, {'power': 3, 'reach': 1.2}),
  'fight_armada_escape': ('Armada Escape', '🌪️', 'fight', False, {'power': 2, 'reach': 1.15}),
  'fight_meia_lua_back': ('Retreating Meia Lua', '🌙', 'fight', False, {'power': 2, 'reach': 1.15}),
  'fight_chapa_giratoria': ('Spinning Chapa', '🌀', 'fight', False, {'power': 2, 'reach': 1.15, 'body': True}),
  'fight_martelo': ('Martelo', '🦶', 'fight', False, {'power': 2, 'reach': 1.1}),
  'fight_martelo_ground': ('Handstand Martelo', '🤸', 'fight', False, {'power': 3, 'reach': 1.1}),
  'fight_martelo_step': ('Stepping Martelo', '🦶', 'fight', False, {'power': 2, 'reach': 1.15}),
  'fight_chapa': ('Chapa Side Kick', '🦶', 'fight', False, {'power': 2, 'reach': 1.2, 'body': True}),
  'fight_spin_back_kick_adv': ('Advancing Spin Kick', '🌪️', 'fight', False, {'power': 3, 'reach': 1.15}),
  'fight_ground_spin_kick': ('Ground Spin Kick', '🌀', 'fight', False, {'power': 2, 'reach': 1.05, 'low': True, 'sweep': True}),
  'fight_capoeira_kicks': ('Capoeira Combo', '🌀', 'fight', False, {'power': 2, 'reach': 1.15}),
  'fight_hook_body_short': ('Short Body Hook', '🥊', 'fight', False, {'power': 1, 'reach': 0.8, 'body': True}),
  'fight_hook_body_mid': ('Body Hook', '🥊', 'fight', False, {'power': 2, 'reach': 0.85, 'body': True}),
  'fight_hook_head_mid': ('Head Hook', '🥊', 'fight', False, {'power': 2, 'reach': 0.85}),
  'fight_hook_head_long': ('Long Hook', '🥊', 'fight', False, {'power': 2, 'reach': 0.95}),
  'fight_right_hook': ('Haymaker', '💥', 'fight', False, {'power': 3, 'reach': 0.9}),
  'fight_jab2': ('Snap Jab', '👊', 'fight', False, {'power': 1, 'reach': 0.95}),
  'fight_cross2': ('Straight Right', '🥊', 'fight', False, {'power': 2, 'reach': 0.95}),
  'fight_hook_rear2': ('Rear Hook 2', '🥊', 'fight', False, {'power': 2, 'reach': 0.85}),
  'fight_hook_lead2': ('Lead Hook 2', '🥊', 'fight', False, {'power': 2, 'reach': 0.85}),
  'fight_body_punch_knee': ('Body Shot + Knee', '💥', 'fight', False, {'power': 2, 'reach': 0.8, 'body': True}),
  'fight_roundhouse_adv': ('Advancing Roundhouse', '🦶', 'fight', False, {'power': 2, 'reach': 1.15}),
  'fight_roundhouse_side': ('Roundhouse To Ribs', '🦶', 'fight', False, {'power': 2, 'reach': 1.15, 'body': True}),
  'fight_roundhouse_rear': ('Rear Roundhouse', '🦶', 'fight', False, {'power': 3, 'reach': 1.15}),
  'fight_roll_kick': ('Rolling Kick', '🌀', 'fight', False, {'power': 3, 'reach': 1.1}),
  'fight_double_snap_kick': ('Double Snap Kick', '🦶', 'fight', False, {'power': 2, 'reach': 1.1}),
  'fight_crescent_kick': ('Aerial Crescent Kick', '🌙', 'fight', False, {'power': 3, 'reach': 1.1}),
  'fight_flying_shoulder_throw': ('Lucha Throw', '🤼', 'fight', False, {'power': 3, 'reach': 0.8}),
  'fight_block_inward': ('Parry', '🛡️', 'defend', False, {}),
  'fhit_groin': ('Low Blow', '😖', 'react', False, {'hit': 'body', 'size': 2}),
  'fhit_body_punch': ('Body Punch Hit', '😫', 'react', False, {'hit': 'body', 'size': 2}),
  'fhit_stomach_uppercut': ('Gut Uppercut Hit', '🤢', 'react', False, {'hit': 'body', 'size': 3}),
  'fhit_face_uppercut': ('Face Uppercut Hit', '😵', 'react', False, {'hit': 'head', 'size': 3, 'side': 'c'}),
  'fhit_groin_fall': ('Low Blow Fall', '😖', 'falls', False, {'then': 'getup_stomach', 'floor': True}),
  'fko_death_knee': ('KO Collapse', '☠️', 'falls', False, {'then': 'getup_stomach', 'floor': True, 'ko': True}),
  'fko_death_standing': ('KO Drop', '☠️', 'falls', False, {'then': 'getup_back', 'floor': True, 'ko': True}),
  'fight_kipup': ('Corkscrew Kip-Up', '🤸', 'jumps', False, {}),
  'fight_kipup_kick': ('Kip-Up Kick', '🤸', 'jumps', False, {}),
  'fight_backflip': ('Backflip', '🔄', 'jumps', False, {}),
  'fight_idle_empty': ('Open Stance', '🥋', 'base', True, {}),
  'fight_ready_jump': ('Jump In Ready', '😤', 'taunt', False, {}),
  'fight_taunt_arms': ('Come On!', '😤', 'taunt', False, {}),
  'fight_insult': ('Insult', '🙄', 'taunt', False, {}),
}

missing = [f for f in files if f not in T]
extra = [k for k in T if k not in files]
assert not missing and not extra, (missing, extra)

# Impact times (s) for attacks — measured peaks of fist/foot extension, cleaned up by hand
H = {
 'jab': [0.5], 'jab_head': [0.47], 'cross': [0.67], 'jab_cross': [0.47, 0.67],
 'hook_lead': [0.63], 'hook_back': [0.77], 'hook_short': [0.5], 'hook_body': [0.93, 1.23],
 'uppercut': [0.55], 'uppercut_back': [0.73], 'uppercut_lead': [0.83],
 'combo4': [0.6, 0.87, 1.1, 1.33], 'combo8': [0.6, 0.93, 1.2, 1.5, 1.87, 2.1, 2.37],
 'elbow': [0.47], 'knee': [0.73], 'headbutt': [0.87], 'knees_uppercut': [1.67, 2.2, 2.7, 4.13],
 'backflip_uppercut': [3.77, 4.57], 'kick_low': [0.6], 'kick_side': [0.6], 'kick_roundhouse': [0.83],
 'kick_high': [0.7], 'kick_spin_back': [1.0], 'flip_kick': [0.87], 'spin_flip_kick': [1.5],
 'bicycle_kick': [0.25, 0.45], 'drop_kick': [0.75], 'hurricane_kick': [0.5, 0.9, 1.3], 'flying_knee': [1.37],
 'armada': [1.17], 'meia_lua': [0.93], 'hadouken': [2.23], 'grab_slam': [2.7],
 # second wave
 'kick_mid': [0.67], 'sweep_back': [0.65], 'sweep_360_back': [1.2], 'sweep_front': [0.6], 'sweep_360': [1.3],
 'flying_sidekick': [0.37], 'armada_escape': [1.37], 'meia_lua_back': [1.6], 'chapa_giratoria': [1.77],
 'martelo': [1.23], 'martelo_ground': [1.27], 'martelo_step': [0.87], 'chapa': [0.67], 'spin_back_kick_adv': [1.83],
 'ground_spin_kick': [1.63], 'capoeira_kicks': [3.97, 5.37, 12.53, 13.9], 'hook_body_short': [0.9], 'hook_body_mid': [1.0],
 'hook_head_mid': [0.5], 'hook_head_long': [0.63], 'right_hook': [0.6], 'jab2': [0.57], 'cross2': [0.37],
 'hook_rear2': [0.4], 'hook_lead2': [0.57], 'body_punch_knee': [0.9, 1.53], 'roundhouse_adv': [1.0],
 'roundhouse_side': [1.1], 'roundhouse_rear': [0.63], 'roll_kick': [0.6], 'double_snap_kick': [0.63, 0.87],
 'crescent_kick': [1.33], 'flying_shoulder_throw': [1.0],
}
# Long or special-purpose clips the fight AI shouldn't pick as normal attacks
NO_FIGHT = {'fight_capoeira_kicks', 'fight_flying_shoulder_throw', 'fight_grab_slam', 'fight_backflip_uppercut', 'fight_knees_uppercut'}

entries = []
for fid in files:
    label, icon, cat, loop, extra = T[fid]
    e = {'id': 'mx_' + fid, 'clip': fid, 'label': label, 'icon': icon, 'category': cat, 'file': fid + '.fbx', 'loop': loop}
    # one-shots carry their travel/turn onto the character; loops stay on the spot
    e['rootMotion'] = not loop
    for k, v in extra.items():
        e[k] = ('mx_' + v) if k in ('then', 'pair') else v
    hk = fid.replace('fight_', '')
    if cat == 'fight' and hk in H:
        e['hits'] = H[hk]
    if fid in NO_FIGHT:
        e['noFight'] = True
    entries.append(e)
json.dump(entries, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(entries), 'entries;', {c: sum(1 for e in entries if e['category'] == c) for c in sorted({e['category'] for e in entries})})
