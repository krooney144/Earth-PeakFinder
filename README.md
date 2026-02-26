


 required parameters lat and lng you can add the following arguments:

| Key	| Argument | Description |
| -------------| -------- | ---- |
| lat |	Latitude (required)	| Float value, Wgs84 Format (lat=42.8612) |
| lng	| Longitude (required) | Float value, Wgs84 Format (lng=-72.1092) |
| name |	Name of the viewpoint (optional) | Text (name=Monadnock%20Mountain), replace spaces with %20 |
| ele | Elevation (optional) | Integer (ele=941) |
| off | Elevation offset (optional) | Integer (off=100) |
| azi | Azimuth (optional) | Float 0.0 .. 360.0 (azi=90.0) |
| alt | Altitude (optional) | Integer -25.0 .. 25.0 (alt=0.0) |
| fov | Field of view (optional) | Integer 8 .. 90.0 (fov=45.0) |
| teleazi & telealt | Azimuth and altitude for displaying the telescope (optional, but both values are required) | Floats 0..360 (teleazi=90.5&telealt=4.5) |







  
  
  panel.init(function() {
    // inside here its save to use the panel
    
    panel.settings.distanceUnit(1) // use imperial (miles, feet) format
            
    panel.loadViewpoint(46.53722, 8.12610, 'Finsteraarhorn') // loads a viewpoint

    // animate to view
    panel.azimut(209.0, 2.0)
    panel.altitude(1.0, 1.0)
    panel.fieldofview(45.0, 2.0)
  });

```


PanoramaPanel. Pass the options in a Javascript dictionary:

**Properties**

| Name | Type | Description |
| --- | --- | --- |
| canvasid | <code>string</code> | The id of the html canvas element. Default: 'canvas' |
| locale | <code>string</code> | The language locale of the module. Default: 'en'. Supported locales: en,de,fr,it,es,pt,ja,ko,zh-Hans,zh-Hant |
| bgcolor | <code>string</code> | A custom color for the background/sky. Normally the sky is white. For another color use the format '#rrggbb' (e.g. #87CEEB for sky color). |
| theme | <code>string</code> | 'dark' for dark-theme. otherwise 'light' theme will be shown |
| disableinfosheets | <code>boolean</code> | Disables showing the poi infosheet or the viewpoint infosheet when the users click on a peak label or the viewpoint |

**Example**  
```js
let panel = new PeakFinder.PanoramaPanel({
  canvasid: 'pfcanvas', 
  locale: 'en'
}) // attach to canvas
```


### PeakFinder~addEventListener(eventname, callback)
Registers an event listenster that receives events from the PanoramaPanel.
This method must be called after the init() resp. asycinit() methode.
The following events are supported:
- 'viewpointjourney finished' : all data for a new viewpoint has been loaded 
- 'viewpoint changed' : viewpoint has changed
- 'sun changed': sun times have beeen changed. 
- 'moon changed': moon times have beeen changed. 
- 'poiinfo show': user has clicked to a peak name or uses the telescope.


| Param | Type | Description |
| --- | --- | --- |
| eventname | <code>string</code> | The name of the event (see list above) |
| callback | <code>function</code> | This function will be called when the requested event is dispached. 'args' will include event data. |

**Example**  
```js
panel.addEventListener('viewpointjourney finished', async function(args) {
  console.log(`viewpoint ready ${JSON.stringify(args)}`)
})
```
<a name="module_PeakFinder..registerCommandsCallback"></a>

### PeakFinder~registerCommandsCallback(command)
Registers a callback that receives commands/messages from the PanoramaPanel.
The PanoramaPanel will send a message when a specific event occured. E.g. when a
new viewpoint was loaded the command: \
<code> viewpoint changed lat=46.53722&lng=8.12610 </code> \
will be sent. 
Normally register to this callback can be skipped.


| Param | Type | Description |
| --- | --- | --- |
| command | <code>function</code> | function must have the format functioname(command). |

**Example**  
```js
panel.registerCommandsCallback(function(cmd) {
  console.log(cmd)
})
```
<a name="module_PeakFinder..init"></a>

### PeakFinder~init(callback)
Loads all the needed stuff for displaying the panorama. Call this method only once.
The async callback will inform when the panorama panel is ready. After this call additional
commands like <code>loadViewpoint</code> may be called.


| Param | Type | Description |
| --- | --- | --- |
| callback | <code>function</code> | This function will be called when everything is ready |

**Example**  
```js
panel.init(function() {
  console.log('ready')
  // inside here you can use panel
  panel.loadViewpoint(46.53722, 8.12610, 'Finsteraarhorn')
  
});
```
<a name="module_PeakFinder..asyncinit"></a>

### PeakFinder~asyncinit()
Loads all the needed stuff for displaying the panorama. Call this method only once.
Same as the init function but with support for the Javascript async pattern. After this call additional
commands like <code>loadViewpoint</code> may be called.

**Example**  
```js
async panel.asyncinit()

console.log('ready')
panel.loadViewpoint(46.53722, 8.12610, 'Finsteraarhorn')
```
<a name="module_PeakFinder..loadViewpoint"></a>

### PeakFinder~loadViewpoint(latitude, longitude, the)
Loads a viewpoint with the given coordinates and an optional name


| Param | Type | Description |
| --- | --- | --- |
| latitude | <code>number</code> |  |
| longitude | <code>number</code> |  |
| the | <code>string</code> | viewpoint name. Optional |

<a name="module_PeakFinder..viewpointJourneyFinished"></a>

### PeakFinder~viewpointJourneyFinished() ⇒ <code>boolean</code>
Checks if the viewpoint journey has been finished.

<a name="module_PeakFinder..azimut"></a>

### PeakFinder~azimut(val, animationduration) ⇒ <code>number</code>
Get/set azimut.


| Param | Description |
| --- | --- |
| val | The azimut value in degrees |
| animationduration | The duration of the animation. If undefined no animation will be done. |

**Example**  
```js
await panel.azimut(120.0, 1.0) // set azimut with an animation time of 1 second

const azimut = panel.azimut() // gets azimut
```
<a name="module_PeakFinder..altitude"></a>

### PeakFinder~altitude(val, animationduration) ⇒ <code>number</code>
Get/set altitude.


| Param | Description |
| --- | --- |
| val | The altitude value in degrees |
| animationduration | The duration of the animation. If undefined no animation will be done. |

<a name="module_PeakFinder..fieldofview"></a>

### PeakFinder~fieldofview(val, animationduration) ⇒ <code>number</code>
Get/set field of view (zoom).


| Param | Description |
| --- | --- |
| val | The field of view (zoom) value in degrees |
| animationduration | The duration of the animation. If undefined no animation will be done. |

<a name="module_PeakFinder..elevationOffset"></a>

### PeakFinder~elevationOffset(val, animationduration) ⇒ <code>number</code>
Get/set elevation offset.


| Param | Description |
| --- | --- |
| val | The elevation offset in meters |
| animationduration | The duration of the animation. If undefined no animation will be done. |

**Example**  
```js
await panel.elevationOffset(200.0, 1.0) // set elevation offset to 200m animation time of 1 second

const elev = panel.elevationOffset() // gets elevation offset
```


**Example**  
```js
panel.settings.distanceUnit(1) // set to imperial

const unit = panel.settings.distanceUnit() // gets imperial

Get/set the coordinates format. \
0: degree (46°30'21"N 8°20'14"E), 1: decimal (46.2412°N 8.1342°E)

### PeakFinder.Settings~projection() ⇒ <code>number</code>
Get/set the projection. \
0: perspective, 1: cylindrical


### PeakFinder.Settings~showSun() ⇒ <code>number</code>
Get/set display of the sun ecliptic. \
0: hide, 1: show

<a name="module_PeakFinder.Settings..visibilityRange"></a>

### PeakFinder.Settings~visibilityRange() ⇒ <code>number</code>
Get/set the visiblitiy range in meters. \
valid range: 0..320000  250mil

<a name="module_PeakFinder.Settings..minimalElevation"></a>

### PeakFinder.Settings~minimalElevation() ⇒ <code>number</code>
Get/set the minimal elevation for the displayed peak names. \
valid range: 0..10000 (10000m, 32000feet)


* * *

## PeakFinder.viewpoint

These methods return information about the current viewpoint.

<a name="module_PeakFinder.Viewpoint..name"></a>

### PeakFinder.Viewpoint~name() ⇒ <code>String</code>
Gets the viewpoint name.

**Returns**: <code>String</code> - the viewpoint name  
<a name="module_PeakFinder.Viewpoint..coordsdecimal"></a>

### PeakFinder.Viewpoint~coordsdecimal() ⇒ <code>String</code>
Gets the viewpoint coordinates in decimal format.

**Returns**: <code>String</code> - the coordinates in decimal format (e.g. 46.53722°N, 8.12610°E)  
<a name="module_PeakFinder.Viewpoint..coordsdegree"></a>

### PeakFinder.Viewpoint~coordsdegree() ⇒ <code>String</code>
Gets the viewpoint coordinates in degree format.

**Returns**: <code>String</code> - the coordinates in degreee format (e.g. 46°32'13''N, 8°07'33''E)  
<a name="module_PeakFinder.Viewpoint..elevation"></a>

### PeakFinder.Viewpoint~elevation() ⇒ <code>number</code>
Gets the viewpoint elevation in meters.

**Returns**: <code>number</code> - the elevation in meters  


**Example**  
```js
panel.astro.currentDateTime(2022, 7, 12, 14, 30)
```
<a name="module_PeakFinder.Astro..currentDateTimeNow"></a>

### PeakFinder.Astro~currentDateTimeNow()
Sets the date/time to now

<a name="module_PeakFinder.Astro..sunTimes"></a>

### PeakFinder.Astro~sunTimes() ⇒ <code>Object</code>
Gets the time of sunrise, sunset.

**Returns**: <code>Object</code> - the sun times (e.g. {"sun":{"rise":"2025-04-07T06:50:59Z","set":"2025-04-07T20:11:59Z"}} )  
<a name="module_PeakFinder.Astro..sunTimes"></a>



## PeakFinder.telescope

These methods can be used to show/hide telescope and get azimut, altitude, distance and elevation.

<a name="module_PeakFinder.Telescope..show"></a>

### PeakFinder.Telescope~show()
Shows the telescope

**Example**  
```js
panel.telescope.show()
```
<a name="module_PeakFinder.Telescope..hide"></a>

### PeakFinder.Telescope~hide()
Hide the telescope

<a name="module_PeakFinder.Telescope..centerAzimut"></a>

### PeakFinder.Telescope~centerAzimut() ⇒ <code>Number</code>
Get the azimut of the telecope center

**Returns**: <code>Number</code> - azimut  
<a name="module_PeakFinder.Telescope..centerAltitude"></a>

### PeakFinder.Telescope~centerAltitude() ⇒ <code>Number</code>
Get the altitude of the telecope center

**Returns**: <code>Number</code> - altitude  
<a name="module_PeakFinder.Telescope..centerDistance"></a>

### PeakFinder.Telescope~centerDistance() ⇒ <code>Number</code>
Get the distance of the telecope center

**Returns**: <code>Number</code> - distance  
<a name="module_PeakFinder.Telescope..centerElevation"></a>

### PeakFinder.Telescope~centerElevation() ⇒ <code>Number</code>
Get the elevation of the telecope center

**Returns**: <code>Number</code> - elevation  

 PanoramaPanel.
