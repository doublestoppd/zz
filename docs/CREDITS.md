# Credits

## Art

The board art is by **Kenney** (https://kenney.nl), released under Creative Commons Zero
(CC0 1.0 Universal, https://creativecommons.org/publicdomain/zero/1.0/). No attribution is
required; it is given gladly. Support them at https://kenney.nl/donate.

Files live in `apps/client/public/assets/kenney/` and were renamed for their role here.
The originals, for anyone who wants more from the same packs:

| Role in the game                       | Pack            | Original file(s)                                                                                                                                                |
| -------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| grass (outdoor ground)                 | Topdown Shooter | `Tiles/tile_01.png` to `tile_04.png`                                                                                                                            |
| wooden floor (inside buildings)        | Topdown Shooter | `Tiles/tile_42.png` to `tile_44.png`                                                                                                                            |
| concrete (spare)                       | Topdown Shooter | `Tiles/tile_07.png`, `tile_08.png`                                                                                                                              |
| asphalt road, lane mark                | Topdown Shooter | `Tiles/tile_86.png`, `tile_87.png`                                                                                                                              |
| brick wall                             | Topdown Shooter | `Tiles/tile_69.png` to `tile_71.png`                                                                                                                            |
| door closed / open leaf / broken       | Topdown Shooter | `Tiles/tile_105.png`, `tile_441.png`, `tile_265.png`                                                                                                            |
| window / broken window                 | Topdown Shooter | `Tiles/tile_436.png`, `tile_291.png`                                                                                                                            |
| containers: home, clinic, police, shop | Topdown Shooter | `Tiles/tile_345.png`, `tile_270.png`, `tile_536.png`, `tile_129.png`                                                                                            |
| extraction marker (spare)              | Topdown Shooter | `Tiles/tile_134.png`                                                                                                                                            |
| survivors by specialty                 | Topdown Shooter | `Survivor 1`, `Woman Green`, `Soldier 1`, `Man Brown`, `Man Red`, `Survivor 2` (`_gun`, `_machine`, `_hold`, `_stand`), plus `Man Blue`, `Man Old`, `Woman Old` |
| zombies                                | Topdown Shooter | `Zombie 1/zoimbie1_hold.png`, `Zombie 2/zombie2_hold.png`                                                                                                       |
| pistol, rifle, shotgun on the ground   | Topdown Shooter | `weapon_gun.png`, `weapon_machine.png`, `weapon_silencer.png`                                                                                                   |
| knife, bat, ammunition, shells         | Topdown Shooter | `Tiles/tile_241.png`, `tile_265.png`, `tile_188.png`, `tile_187.png`, `tile_242.png`                                                                            |
| medkit, bandage, key, radio parts      | Generic Items   | `Colored/genericItem_color_102.png`, `_100.png`, `_155.png`, `_063.png`                                                                                         |

The packs were fetched from a community mirror of Kenney's CC0 library
(https://github.com/shorepine/kenney) because the sandbox this was built in could not
reach kenney.nl directly; the licence text is the pack's own.

## Sound

Recorded samples are Kenney's, CC0, from `apps/client/public/assets/kenney/audio/`
(`apps/client/src/audio/samples.ts` maps sounds to files). A sound without a sample keeps
the client's synthesised tone (`SoundPlayer.ts`): gunshots and the zombie growl.

| Sound                 | Pack             | Original file(s)                                                             |
| --------------------- | ---------------- | ---------------------------------------------------------------------------- |
| step                  | Impact Sounds    | `footstep_concrete_000.ogg`, `footstep_concrete_001.ogg`                     |
| hit                   | Impact Sounds    | `impactPunch_heavy_000.ogg`                                                  |
| crash (forced entry)  | Impact Sounds    | `impactGlass_heavy_000.ogg`, `impactPlank_medium_000.ogg`                    |
| door                  | RPG Audio        | `doorOpen_1.ogg`, `doorOpen_2.ogg`                                           |
| pickup, reload, swing | RPG Audio        | `handleCoins.ogg`, `metalLatch.ogg`, `knifeSlice.ogg`                        |
| heal, your turn       | Interface Sounds | `confirmation_001.ogg`, `bong_001.ogg`                                       |
| victory, defeat       | Music Jingles    | `Pizzicato jingles/jingles_PIZZI00.ogg`, `Steel jingles/jingles_STEEL01.ogg` |
