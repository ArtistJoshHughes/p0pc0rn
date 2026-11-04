# The trash trolley model in Troll-E (games/trolley/)

- **What:** `equipment_trash_trolley_a01`, a SimReady asset by NVIDIA (author "NVIDIA" in the asset's own metadata), from NVIDIA
  SimReady's common assets (`props_automotive_equipment/equipment_trash_trolley_a01`), published at
  https://huggingface.co/datasets/nvidia/simready-assets/tree/main/equipment_trash_trolley_a01
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0), as the asset states (`asset_license = "CC-BY-4.0"`).
  The licence: https://creativecommons.org/licenses/by/4.0/
- **Credit:** "Trolley model: equipment_trash_trolley_a01, NVIDIA SimReady, CC BY 4.0." The game shows this line on its start and
  end screens.
- **Changes made for p0pc0rn (this is a modified version, not NVIDIA's original):**
  - converted from USD to glTF (`games/trolley/assets/trolley.glb`), Y up;
  - reduced from 2,727,168 to 304,967 triangles (decals kept whole);
  - the tread plates baked to texture; the UDIM textures packed into atlases and resized; some tiled textures replaced by flat values;
  - the red glass light lenses made a plain emissive red;
  - every part kept on its own pivot, and the part list with joint axes, limits and masses written out (`trolley_parts.json`);
  - in the game the parts are driven by the game's own physics (the motors and springs are the game's; the asset has none).
- **Also derived from it:** the Games screen's cover for Troll-E (`icons/games/trolley-cover.jpg`) is a frame drawn by the game
  itself, with this model in it. The same credit and licence apply.
- NVIDIA does not endorse p0pc0rn or this game. No warranties are given (CC BY 4.0, section 5).
