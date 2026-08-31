> Generated from [storm-reports.md](./storm-reports.md) by [deamericanise](https://www.npmjs.com/package/deamericanise).
> Preset `read`, dialect `en-AU`, 8 changes. Every change is in **bold**.
>
> An ambiguous numeric date, in prose American enough to settle which way it reads.

# Storm Reports for April 3, 2024

Preliminary local storm reports collected by the Storm Prediction Center. Each entry
is the comment field submitted by the National Weather Service forecast office shown
in brackets.

- A National Weather Service Storm Survey confirmed an EF1 tornado on **2024-04-03** in Richmond and Northumberland Counties. The tornado touched down near Luttrellville Lane a (AKQ)

- A NWS storm survey discovered damage due to an EF0 tornado with a maximum width of **114 metres** that briefly touched down in the Beacon Lake **neighbourhood** in northern St Jo (JAX)

- Tree down on home at the south end of Columbia County. Home is off of 996 SW Bluff ... **3.2 kilometres** west of SR 47. (JAX)

- Skywarn Spotter submitted a report of large tree branches down ... greater than **10 centimetres** in diameter ... near the intersection of NW 15th Avenue and NW 85th Street in Oca (JAX)

- USSF Tower 1102 measured a wind gust of **110 km/h**/61 kt from the west-southwest. (MLB)

- Multiple damage to homes on Owltown Road. Several trees and power poles downed. Debris partially blocking Adjacent sections of US-360. (AKQ)

- Multiple reports of **18 to 24 mm** hail near Jackson. One photo of close comparison to quarter on social media. (PHI)

- *** 1 INJ *** Tree fell on a single wide mobile home with one minor injury. Report from the State Watch Office and time is based on radar. (JAX)

- Tree down on powerline near SW 31st Ln and W SR 238. Time is estimated by RADAR. (JAX)

- Pictures relayed via social media of various damage to a **neighbourhood** near US1 and County Rd 210W. Damage included large fence blown partially over ... several small tre (JAX)

- Levy County Sheriff Office reported a tree down across eastbound lane of FL Hwy 500 east of Chiefland. Time estimated from radar. (TBW)

- Tree down across the left lane of the William F. Stone Highway at the Joseph Martin Highway Exit. (RNK)

- Broadcast media had a photo showing a large tree branch blocking the left lane of Arlington Expressway eastbound near the Southside connector ramp. (JAX)

- Variety of storm related damaged relayed by EM near NW Highway 225A including a snapped water oak tree ... and a flipped horse trailer. General time estimated via radar. (JAX)

---

Source: <https://www.spc.noaa.gov/climo/reports/240403_rpts.html>

Storm Prediction Center, National Weather Service, National Oceanic and Atmospheric
Administration. Public domain: a work of the United States federal government, not
subject to copyright protection under 17 U.S.C. section 105.

## What changed

| Line | Before | After | Rule | Confidence |
| --- | --- | --- | --- | --- |
| 7 | `4/3/2024` | `2024-04-03` | `dates.numeric` | risky |
| 9 | `125 yards` | `114 metres` | `units.length.yard` | moderate |
| 9 | `neighborhood` | `neighbourhood` | `spelling.our` | safe |
| 11 | `2 miles` | `3.2 kilometres` | `units.length.mile` | moderate |
| 13 | `4 inches` | `10 centimetres` | `units.length.inch` | moderate |
| 15 | `70 mph` | `110 km/h` | `units.speed.mph` | moderate |
| 19 | `dime to quarter-sized` | `18 to 24 mm` | `units.length.coin` | risky |
| 25 | `neighborhood` | `neighbourhood` | `spelling.our` | safe |

## How American it read

**90% American.** Above the 0.5 threshold, so the rules that need to know where the text came from ran.

Markers found: `-er spelling`, `imperial units`, `abbreviations with stops`.

No numeric date states its own order.

Dates with the month written out: 1 month-first, 0 day-first. Evidence about the prose, not about the numeric dates beside it.
