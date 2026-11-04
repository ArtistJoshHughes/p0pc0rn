# The props in Troll-E (games/trolley/assets/props/)

- **What:** NVIDIA SimReady Assets (the Hugging Face dataset `nvidia/simready-assets`, https://huggingface.co/datasets/nvidia/simready-assets),
  all by NVIDIA. Each asset's own packaging metadata says `CC-BY-4.0`.
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0): https://creativecommons.org/licenses/by/4.0/
- **Credit:** "3D assets: NVIDIA SimReady Assets (CC BY 4.0), modified." The game shows this line on its start and end screens.
- **Changes made for p0pc0rn (modified versions, not NVIDIA's originals):** converted from OpenUSD to glTF 2.0, decimated for phones,
  textures resized; as listed below. In the game the props are driven by the game's own physics.
- The brand names on some labels (TORVYNT, ColaBuzz, aquvia, Homestad Farm, IntruMedis and others) are NVIDIA's fictional artwork that
  comes with the assets. Two real makers' marks that came with NVIDIA's assets were removed for p0pc0rn (4.0): the logo plates of
  `labware_table_thorlabs_a01` in `craft_r18_photon_altar.glb` are plain, and a maker's web address is painted out of the warning
  decal of `dock_hopper.glb` ("modified: brand marks removed"). CC BY 4.0 licenses no trademarks (section 2(b)(2)).
- NVIDIA does not endorse p0pc0rn or this game. No warranties are given (CC BY 4.0, section 5).

| file | source asset (nvidia/simready-assets/…) | changes |
|---|---|---|
| `arm_cobot_claw.glb` | `robotic_system_arm_b01` (the arm links), `serviceTool_pliers_oilFilter_a01` (the claw), `structure_beam_a01` (the bracket's rust texture) | the arm's links only (cart, lift column and needle instrument removed), decimated, scaled 1.2x, limits re-rigged; the pliers' grips removed, the jaw's lever shortened, scaled 1.4x and mounted on the arm's flange; the welded bracket is generated geometry |
| `diesel_can.glb` | `consumable_antifreeze_diesel_engine_a01` | decimated, textures resized |
| `trash_soda_can.glb` | `food_beverage_can_b01` | decimated, textures resized |
| `trash_tin_can.glb` | `food_processed_cannedFood_b01` | decimated, textures resized |
| `trash_water_bottle.glb` | `food_beverage_bottledWater_b01` | decimated, textures resized, glass as alpha blend |
| `trash_beer_bottle.glb` | `food_beverage_beerBottle_a01` | decimated, textures resized, glass as alpha blend |
| `trash_juice_carton.glb` | `food_beverage_boxedDrink_a01` | decimated, textures resized |
| `trash_chips_bag.glb` | `food_processed_chips_a01` | decimated, textures resized |
| `trash_cardboard_box.glb` | `warehouse_box_cube_a07` | textures resized |
| `battery.glb` | `electricalSystem_battery_a01` | decimated |
| `drum_rusty.glb` | `drum_steel_a01`, with `structure_beam_a01`'s rust tile | decimated, the lid its own node, retextured rusty |
| `pallet_wood.glb` | `pallet_wood_recycled_a05` | decimated, textures resized |
| `barricade.glb` | `environment_barricade_a01` | decimated, UDIM tiles packed into one atlas |

## The world round the hall (games/trolley/assets/world/)

The tutorial's four quadrants (the industrial dock's yard, the park, the metro, the dead forest) are dressed with these. Same source,
same licence and the same credit line as above. Each was converted from OpenUSD to glTF 2.0 and decimated, its flat material tiles were
given a small baked grime texture (the colour modulated by `structure_beam_a01`'s rust spots), and some were re-coloured to the game's
neon. The crate, the hopper, the info kiosk, the siren pole, the wheelbarrow and the board keep NVIDIA's own textures; in the game the
grime shader goes over them. In the game every texture is drawn down to 512 px at load, and they are static set dressing.

| file | source asset (nvidia/simready-assets/…) | changes |
|---|---|---|
| `dock_forklift_stacker.glb` | `vehicle_forklift_orange_a01` | decimated (330k to 14k triangles), baked grime |
| `dock_pallet_jack.glb` | `palletJack_heavyDuty_a01` | decimated, baked grime |
| `dock_ibc_tank.glb` | `ibcTank_a02` | decimated, baked grime (the cage rusty) |
| `dock_crate.glb` | `crate_plywood_b02` | decimated |
| `dock_pallet_rack.glb` | `rack_large_empty_a01` | decimated, baked grime |
| `dock_hopper.glb` | `hopper_dumpling_steel_red_a07` | decimated; modified: brand marks removed (a maker's web address, and the words that led to it, painted out of the warning decal) |
| `dock_edge_rail.glb` | `barrier_gate_safetyDock_a02` | decimated, baked grime |
| `park_bench_sofa.glb` | `sofa_visitor_a01` | decimated, baked grime (a park bench's stand-in) |
| `park_armchair.glb` | `sofa_soft_b01` | decimated, baked grime |
| `park_water_cooler.glb` | `water_cooler_a01` | decimated, baked grime |
| `park_coffee_kiosk.glb` | `machine_coffee_vending_a01` | decimated, baked grime, its LED frame re-coloured magenta |
| `park_bin_domed.glb` | `trashCan_domed_blue_b01` | decimated, baked grime |
| `park_floodlight.glb` | `lighting_taskLight_tripodFlood_a01` | decimated, baked grime |
| `metro_car_frame.glb` | `carFrame_car_frame_assembled_a01` | decimated (2.8M to 53k triangles), baked grime and rust |
| `metro_info_kiosk.glb` | `digitalSystem_infoKiosk_vertical_a01` | decimated, its screen's emission map kept |
| `metro_vending_machine.glb` | `machine_vending_snacksDrinks_a01` | decimated, baked grime, its light strip re-coloured cyan |
| `metro_jersey_barrier.glb` | `barrier_wall_plastic_orange_a03` | decimated, baked grime |
| `metro_utility_cabinet.glb` | `electrical_power_terminal_a01` | decimated, baked grime |
| `metro_siren_pole.glb` | `equipment_alarm_siren_a01` | decimated, its lamp glass emissive red |
| `metro_wheelie_bin.glb` | `trashCan_wheeled_black_a01` | decimated, baked grime |
| `metro_hvac_duct.glb` | `hvac_vent_system_straight_a01` | decimated, baked grime |
| `forest_wheelbarrow.glb` | `construction_wheelbarrow_metal_a01` | decimated |
| `forest_pipe_bundle.glb` | `pipe_plastic_black_b06` | decimated, baked grime |
| `forest_board_rotten.glb` | `misc_boards_wooden_a02` | decimated |
| `dead_tree_kit.glb` | the bark texture: `pallet_wood_recycled_a05`'s `T_Wood_Recycled_A1`, tinted | the trees, stump, log and branches are the p0pc0rn project's own procedural geometry; only the bark texture is NVIDIA's |

## The open world (games/trolley/assets/survival/, assets/craft/; v5)

The supplies, the salvage, the shelter kits, the night lights, the energy leech, the solar panel and the 24 crafted machines. Same source,
same licence and the same credit line as above (the game's cards also give the source: https://huggingface.co/datasets/nvidia/simready-assets).
Each was converted from OpenUSD to glTF 2.0 and decimated for phones; most carry a baked grime texture (the colour modulated by
`structure_beam_a01`'s rust spots); the crafted machines were given one neon accent (cyan or magenta) on a part that already looked like
a light or a screen. In the game the world's copies have their textures drawn down to 512 px at load. The brand names on some labels are
NVIDIA's fictional artwork (two real makers' marks were removed: above). NVIDIA does not endorse p0pc0rn or this game.

| file | source asset (nvidia/simready-assets/...) | changes |
|---|---|---|
| `beam_rusty.glb` | `structure_beam_a01` | decimated, baked grime |
| `dock_charger.glb` | `equipment_robot_charger_a01` | decimated, baked grime |
| `energy_leech.glb` | `consumable_hose_hydraulic_a02`, `equipment_extensionCord_EV_type2_a01`, `equipment_surgeProtector_batteryClamp_b01`, `consumable_lightBulb_py21w_amber_a01` | a rearrangement of NVIDIA parts: the hose cut into six body segments, the EV plug as its head, the jumper clamps as jaws, two bulb domes as eyes; decimated, re-textured dark |
| `fuel_jug.glb` | `consumable_hydraulic_fluid_a01` | decimated, baked grime |
| `item_alternator.glb` | `electricalSystem_alternator_a01` | decimated, baked grime |
| `item_anesthesia_mask.glb` | `anesthesia_mask_a01` | decimated, baked grime |
| `item_battery_9v.glb` | `power_battery_9v_a01` | decimated, baked grime |
| `item_cctv_dome.glb` | `detector_camera_a01` | decimated, baked grime |
| `item_copper_cable.glb` | `electrical_cable_a01` | decimated, baked grime |
| `item_extinguisher.glb` | `fireProtection_extinguisher_portable_b01` | decimated, baked grime |
| `item_fuse.glb` | `consumable_fuse_mega_orange_a01` | decimated, baked grime |
| `item_hydraulic_hose.glb` | `consumable_hose_hydraulic_a01` | decimated, baked grime |
| `item_iv_pole.glb` | `IV_pole_a01` | decimated, baked grime |
| `item_jumper_clamps.glb` | `equipment_surgeProtector_batteryClamp_b01` | decimated, baked grime |
| `item_light_bulb.glb` | `consumable_lightBulb_h7_a01` | decimated, baked grime |
| `item_multimeter_clamp.glb` | `testingTool_multimeter_clamp_b01` | decimated, baked grime |
| `item_office_monitor.glb` | `computer_monitor_office_a01` | decimated, baked grime |
| `item_oilfilter_pliers.glb` | `serviceTool_pliers_oilFilter_a01` | decimated, baked grime |
| `item_shop_fan.glb` | `climate_shopFan_pedestal_a01` | decimated, baked grime |
| `item_wrench.glb` | `handTool_wrench_monkey_a01` | decimated, baked grime |
| `led_hexgrid.glb` | `lighting_overheadLed_hexGrid_a01` | decimated, baked grime |
| `night_alarm_beacon.glb` | `warehouse_fireAlarmLight_a01` | decimated, baked grime |
| `night_inspection_lamp.glb` | `lighting_taskLight_cordedInspection_a01` | decimated, baked grime |
| `night_strip_light.glb` | `lighting_taskLight_linearStripBench_a01` | decimated, baked grime |
| `night_tea_candles.glb` | `lighting_candles_tea_a01` | decimated, baked grime |
| `night_work_light.glb` | `lighting_taskLight_portableWork_a01` | decimated, baked grime |
| `shelter_a_accordion_gate.glb` | `barrier_gate_safety_a02` | one half of the safety gate, split into its fixed post, lattice and moving post so it folds; decimated, baked grime |
| `shelter_a_bedding.glb` | `bedding_a01` | decimated, baked grime |
| `shelter_a_bollard.glb` | `machineGuard_a01` | decimated, baked grime |
| `shelter_a_coolant_tank.glb` | `ibcTank_steel_stainless_a01` | decimated, baked grime |
| `shelter_a_roof_pallet.glb` | `pallet_rackable_solid_top_blue_a02` | decimated, baked grime |
| `shelter_a_roof_slab.glb` | `structure_ceiling_a01` | decimated, baked grime |
| `shelter_a_storage_shelf.glb` | `storage_shelf_basic_a01` | decimated, baked grime |
| `shelter_a_wire_wall.glb` | `wire_securityRoom_b01` | decimated, baked grime |
| `shelter_b_crate.glb` | `crate_plywood_b01` | decimated, baked grime |
| `shelter_b_scaffold.glb` | `scaffold_rolling_steel_a03` | decimated, baked grime |
| `shelter_c_guard_panel.glb` | `wire_machineGuard_a01` | decimated, baked grime |
| `shelter_c_warehouse_bay.glb` | `modular_warehouse_h450cm_center_a01` | decimated, baked grime |
| `shelter_c_warehouse_corner.glb` | `modular_warehouse_h450cm_corner_in_a01` | decimated, baked grime |
| `shelter_tool_cabinet.glb` | `furniture_workbench_modular_a01` | decimated, baked grime |
| `shelter_workbench.glb` | `furniture_workbench_standard_e01` | decimated, baked grime |
| `solar_panel.glb` | `lighting_overheadLed_lightPanel_a01` | the LED ceiling panel turned into a solar panel: cables removed, scaled to 0.31 x 0.52 m, its face re-mapped to procedural solar cells (three age tiers: tex/) |
| `craft_r01_tetrabrachion.glb` | `robotic_system_a01` | decimated, baked grime, one neon accent |
| `craft_r02_heliostat_rail.glb` | `extrusion_tSlot_aluminum_b06` | decimated, baked grime, one neon accent |
| `craft_r03_dioscuri_rig.glb` | `robot_surgical_c01` | decimated, baked grime, one neon accent |
| `craft_r04_lumen_vigil.glb` | `lamp_uvc_robot_a01` | decimated, baked grime, one neon accent |
| `craft_r05_mole_courier.glb` | `robotics_small_bot_a01` | decimated, baked grime, one neon accent |
| `craft_r06_roentgen_furnace.glb` | `Xray_machine_HVgenerator_a01` | decimated, baked grime, one neon accent |
| `craft_r07_skiagraph_pillar.glb` | `Xray_machine_buckyStand_a01` | decimated, baked grime, one neon accent |
| `craft_r08_coherent_lance.glb` | `laser_system_a01` | decimated, baked grime, one neon accent |
| `craft_r09_echo_psalter.glb` | `ultrasound_b01` | decimated, baked grime, one neon accent |
| `craft_r10_cadmium_leachfilter.glb` | `hemodialysis_machine_a01` | decimated, baked grime, one neon accent |
| `craft_r11_somnus_bellows.glb` | `anesthesia_machine_a01` | decimated, baked grime, one neon accent |
| `craft_r12_iron_breath.glb` | `lung_ventilation_artificial_a01` | decimated, baked grime, one neon accent |
| `craft_r13_lazarus_clamps.glb` | `defibrillator_a01` | decimated, baked grime, one neon accent |
| `craft_r14_matter_loom.glb` | `equipment_3d_printer_b01` | decimated, baked grime, one neon accent |
| `craft_r15_arc_forge.glb` | `powerTool_welding_station_c01` | decimated, baked grime, one neon accent |
| `craft_r16_ley_junction.glb` | `electrical_main_terminal_a01` | decimated, baked grime, one neon accent |
| `craft_r17_charge_oracle.glb` | `testingTool_battery_analyzer_c01` | decimated, baked grime, one neon accent |
| `craft_r18_photon_altar.glb` | `labware_table_thorlabs_a01` | decimated, baked grime, one neon accent; modified: brand marks removed (the logo plates plain) |
| `craft_r19_salamander_lung.glb` | `climate_heater_dieselTorpedo_a01` | decimated, baked grime, one neon accent |
| `craft_r20_dynamo_heart.glb` | `engineAssembly_electric_engine_a01` | decimated, baked grime, one neon accent |
| `craft_r21_leech_collar.glb` | `equipment_surgeProtector_batteryClamp_a01` | decimated, baked grime, one neon accent |
| `craft_r22_contrast_syringe.glb` | `CT_injection_system_a01` | decimated, baked grime, one neon accent |
| `craft_r23_warmth_eye.glb` | `detector_thermal_fire_a01` | decimated, baked grime, one neon accent |
| `craft_r24_small_vigil.glb` | `lamp_uvc_a01` | decimated, baked grime, one neon accent |
| `tex/solar_cells_{new,aged,ruined}.jpg` | `lighting_overheadLed_lightPanel_a01` (its face's UVs) | the solar panel's three age tiers, procedural cells |
