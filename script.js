// ═══════════════════════════════════════════════════════════════

const map = L.map('map', { zoomControl: false }).setView([45.9432, 24.9668], 7);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap & CARTO'
}).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
    maxZoom: 19
}).addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);

const AVG_SPEED_KMH = 80;                          

const ANIM_TARGET_FRAMES = 70;
const toPrice = (km) => (km * 2.5).toFixed(0);    
const toTime = (km) => (km / AVG_SPEED_KMH).toFixed(1); 
const kmLabel = (km) => `${km.toFixed(0)} km (~${toTime(km)}h)`;

let sourceNode = null;
let destNode = null;
let graphData = null;
let edgeLayers = [];
let nodeLayers = [];
let totalVehicles = 0;
let heatmapActive = false;
let activeVehicles = [];   
let gpsMarkers = [];

let trips = [];                 
let tripCounter = 0;
let vehicleCounter = 0;
let selectedTripId = null;      
let selectedVehicleNum = null;  
let showAllTrips = false;       

const sessionLog = [];

let statsData = { vehicles: 0, uniqueRoutes: 0, congested: 0, blocked: 0 };

let vizState = { active: false, frames: [], path: [], explored: 0, step: 0, playing: false, timer: null };

let multiStopMode = false;
let waypoints = [];

const routeColors = ['#00f2fe', '#00ff87', '#fe0979', '#f6d365', '#b3ffab', '#ff6b6b', '#a29bfe', '#fd79a8'];

const SVG = {

    truck: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="#0b1120" stroke-width="0.8" stroke-linejoin="round"><path d="M3 4a2 2 0 0 0-2 2v9a1 1 0 0 0 1 1h1.05a2.5 2.5 0 0 1 4.9 0h5.1a2.5 2.5 0 0 1 .2-.74V6a2 2 0 0 0-2-2H3z"/><path d="M15 8h3.1a1 1 0 0 1 .8.4l2.9 3.87a1 1 0 0 1 .2.6V15a1 1 0 0 1-1 1h-.05a2.5 2.5 0 0 0-4.9 0H15V8z"/><circle cx="6.5" cy="16.5" r="1.8"/><circle cx="17.5" cy="16.5" r="1.8"/></svg>`,
    pin: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="#0b1120" stroke-width="0.8"><path d="M12 2a8 8 0 0 0-8 8c0 6 8 12 8 12s8-6 8-12a8 8 0 0 0-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg>`,
};

function ic(name, size = 14)
{
    return `<i data-lucide="${name}" style="width:${size}px;height:${size}px;display:inline-block;vertical-align:-2px"></i>`;
}

function refreshIcons()
{
    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
}

const sourceDisplay = document.getElementById('source-display');
const destDisplay = document.getElementById('dest-display');
const algoLog = document.getElementById('algo-log');
const roadTooltip = document.getElementById('road-tooltip');
const roadTooltipContent = document.getElementById('road-tooltip-content');

function flashKPI(id, newVal)
{
    const el = document.getElementById(id);
    el.textContent = newVal;
    el.classList.remove('kpi-flash');
    void el.offsetWidth;
    el.classList.add('kpi-flash');
}

function updateStats()
{
    if (!graphData) return;
    const congested = graphData.edges.filter(e => !e.obstacle && e.congestion > 0).length;
    const blocked = graphData.edges.filter(e => e.obstacle).length;
    flashKPI('stat-vehicles', totalVehicles);
    flashKPI('stat-routes-unique', statsData.uniqueRoutes);
    flashKPI('stat-congested', congested);
    flashKPI('stat-blocked', blocked);
    const badgeEl = document.getElementById('vehicle-count-badge');
    if (badgeEl) badgeEl.textContent = totalVehicles;
}

const LOG_ICONS = {
    system: 'info',
    dispatch: 'truck',
    success: 'check-circle-2',
    reroute: 'shuffle',
    blocked: 'x-circle',
    obstacle: 'alert-triangle',
};
function addLog(message, type = 'system')
{
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const now = new Date();
    const ts = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    const iconName = LOG_ICONS[type] || 'info';

    const safe = message.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    entry.innerHTML = `${ic(iconName, 13)} <span class="log-ts">[${ts}]</span> ${safe}`;
    algoLog.insertBefore(entry, algoLog.firstChild);
    refreshIcons();
}

function updateUI()
{
    sourceDisplay.textContent = sourceNode || 'Not set';
    destDisplay.textContent = destNode || 'Not set';
    sourceDisplay.style.color = sourceNode ? '#00f2fe' : '';
    destDisplay.style.color = destNode ? '#fe0979' : '';
    const simLabel = document.getElementById('sim-route-label');
    if (sourceNode && destNode) simLabel.textContent = `${sourceNode} → ${destNode}`;
    else simLabel.textContent = 'Select on map';
}

document.getElementById('clear-source').addEventListener('click', () => { sourceNode = null; updateUI(); drawGraph(); });
document.getElementById('clear-dest').addEventListener('click', () => { destNode = null; updateUI(); drawGraph(); });

function rebuildPerVehiclePanel()
{
    const n = parseInt(document.getElementById('fleet-size').value) || 1;
    const panel = document.getElementById('per-vehicle-panel');
    const list = document.getElementById('per-vehicle-list');
    const toggle = document.getElementById('per-vehicle-toggle');

    panel.style.display = n > 1 ? 'block' : 'none';
    if (n <= 1) return;

    list.innerHTML = '';
    const defaultStrat = document.getElementById('strategy-select').value;
    if (toggle.checked)
    {
        for (let i = 1; i <= n; i++)
        {
            const row = document.createElement('div');
            row.className = 'pv-row';
            row.innerHTML = `<span class="pv-label">V${i}</span>` +
                `<select class="config-select pv-select" data-vehicle="${i}">` +
                `<option value="balanced" ${defaultStrat === 'balanced' ? 'selected' : ''}>Balanced</option>` +
                `<option value="distance" ${defaultStrat === 'distance' ? 'selected' : ''}>Distance</option>` +
                `<option value="weather" ${defaultStrat === 'weather' ? 'selected' : ''}>Weather</option>` +
                `<option value="traffic" ${defaultStrat === 'traffic' ? 'selected' : ''}>Traffic</option>` +
                `</select>`;
            list.appendChild(row);
        }
    } else
    {
        list.innerHTML = `<div class="pv-hint">All vehicles use: <strong>${defaultStrat}</strong></div>`;
    }
}

document.getElementById('fleet-minus').addEventListener('click', () =>
{
    const inp = document.getElementById('fleet-size');
    inp.value = Math.max(1, parseInt(inp.value) - 1);
    rebuildPerVehiclePanel();
});
document.getElementById('fleet-plus').addEventListener('click', () =>
{
    const inp = document.getElementById('fleet-size');
    inp.value = Math.min(50, parseInt(inp.value) + 1);
    rebuildPerVehiclePanel();
});
document.getElementById('fleet-size').addEventListener('change', rebuildPerVehiclePanel);
document.getElementById('per-vehicle-toggle').addEventListener('change', rebuildPerVehiclePanel);
document.getElementById('strategy-select').addEventListener('change', rebuildPerVehiclePanel);

async function loadGraph()
{
    const res = await fetch('/api/graph');
    graphData = await res.json();
    updateStats();
    drawGraph();
}

function getCityCoords(id)
{
    const n = graphData.nodes.find(n => n.id === id);
    return n ? [n.lat, n.lng] : null;
}

function getEdge(a, b)
{
    return graphData.edges.find(e =>
        (e.source === a && e.target === b) || (e.source === b && e.target === a));
}

function edgeCoords(a, b)
{
    const edge = getEdge(a, b);
    const A = getCityCoords(a), B = getCityCoords(b);
    if (edge && edge.geometry && edge.geometry.length > 1)
    {

        const geo = edge.geometry;
        const startsAtA = A && Math.hypot(geo[0][0] - A[0], geo[0][1] - A[1]) <
            Math.hypot(geo[0][0] - B[0], geo[0][1] - B[1]);
        return startsAtA ? geo : geo.slice().reverse();
    }
    return (A && B) ? [A, B] : [];
}

function buildDenseRoute(pathIds)
{
    const dense = [];
    for (let i = 0; i < pathIds.length - 1; i++)
    {
        const seg = edgeCoords(pathIds[i], pathIds[i + 1]);

        if (i > 0 && seg.length) seg.shift();
        dense.push(...seg);
    }
    return dense;
}

function drawGraph()
{
    edgeLayers.forEach(l => map.removeLayer(l));
    nodeLayers.forEach(l => map.removeLayer(l));
    edgeLayers = [];
    nodeLayers = [];

    graphData.edges.forEach(edge =>
    {
        const u = getCityCoords(edge.source);
        const v = getCityCoords(edge.target);
        if (!u || !v) return;

        let color = 'rgba(255,255,255,0.12)', weight = 3, opacity = 1, dashArray = null;

        if (edge.obstacle)
        {
            color = '#ff4757'; weight = 5; dashArray = '8, 6';
        } else if (edge.weather_event)
        {
            color = '#38bdf8'; weight = 5; dashArray = '10, 5';
        } else if (heatmapActive && edge.congestion > 0)
        {
            color = edge.congestion >= 5 ? '#ef4444' : (edge.congestion >= 3 ? '#f97316' : '#eab308');
            weight = 3 + edge.congestion * 1.5;
            opacity = 0.9;
        } else if (!heatmapActive && edge.congestion > 0)
        {
            color = '#ffaa00';
            weight = Math.min(3 + edge.congestion * 1.5, 9);
            opacity = Math.min(0.4 + edge.congestion * 0.12, 0.85);
        }

        const poly = L.polyline(edgeCoords(edge.source, edge.target), { color, weight, opacity, dashArray, lineCap: 'round' }).addTo(map);

        poly.on('mousemove', (e) =>
        {
            roadTooltip.classList.remove('hidden');
            roadTooltip.style.left = (e.originalEvent.clientX + 14) + 'px';
            roadTooltip.style.top = (e.originalEvent.clientY - 40) + 'px';

            let status = `<span class="status-dot status-clear"></span> Clear`;
            if (edge.obstacle) status = `<span class="status-dot status-blocked"></span> BLOCKED`;
            else if (edge.weather_event) status = `${ic('cloud-lightning')} WEATHER ALERT`;
            else if (edge.congestion > 0) status = `<span class="status-dot status-congested"></span> Congested (${edge.congestion}x)`;

            const baseCost = edge.base_cost || edge.cost;
            roadTooltipContent.innerHTML = `
                <div class="road-name">${edge.source} → ${edge.target}</div>
                <div class="road-stat"><span>Status</span><span>${status}</span></div>
                <div class="road-stat"><span>Distance</span><span>${baseCost.toFixed(0)} km</span></div>
                <div class="road-stat"><span>Est. Time</span><span>${toTime(baseCost)}h</span></div>
                <div class="road-stat"><span>Click to</span><span>${edge.obstacle ? 'Unblock' : 'Block'}</span></div>`;
            refreshIcons();
        });
        poly.on('mouseout', () => roadTooltip.classList.add('hidden'));

        poly.on('click', async () =>
        {
            roadTooltip.classList.add('hidden');
            await fetch('/api/obstacle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ u: edge.source, v: edge.target })
            });
            addLog(`${edge.obstacle ? 'Cleared' : 'Blocked'}: ${edge.source} ↔ ${edge.target}`, edge.obstacle ? 'success' : 'blocked');
            await loadGraph();
        });

        edgeLayers.push(poly);
    });

    graphData.nodes.forEach(node =>
    {
        const isSrc = node.id === sourceNode;
        const isDst = node.id === destNode;
        const wpIndex = waypoints.indexOf(node.id);   
        let color = '#3b82f6', radius = 7, weight = 2;
        if (isSrc) { color = '#00f2fe'; radius = 11; weight = 3; }
        else if (isDst) { color = '#fe0979'; radius = 11; weight = 3; }
        if (wpIndex !== -1) { color = '#f6d365'; radius = 12; weight = 3; }  

        const circle = L.circleMarker([node.lat, node.lng], {
            radius, fillColor: '#07090f', color, weight, opacity: 1, fillOpacity: 1
        }).addTo(map);

        const labelText = wpIndex !== -1 ? `${wpIndex + 1}. ${node.id}` : node.id;
        circle.bindTooltip(labelText, { permanent: true, direction: 'right', className: 'city-label' });

        circle.on('click', () =>
        {
            if (multiStopMode)
            {

                if (waypoints[waypoints.length - 1] !== node.id) waypoints.push(node.id);
                renderWaypointList();
                drawGraph();
                return;
            }
            if (!sourceNode) sourceNode = node.id;
            else if (!destNode && node.id !== sourceNode) destNode = node.id;
            else { sourceNode = node.id; destNode = null; }
            updateUI();
            drawGraph();
        });

        circle._cityId = node.id;       
        nodeLayers.push(circle);
    });

    if (vizState.active) renderVizFrame();
}

function animateVehicle(vehicle)
{
    const coords = buildDenseRoute(vehicle.pathIds).filter(Boolean);
    if (coords.length < 2) return;
    if (vehicle.animId) cancelAnimationFrame(vehicle.animId);
    vehicle.seg = 0;
    vehicle.t = 0;
    vehicle.marker.setLatLng([coords[0][0] + (vehicle.offsetLat || 0), coords[0][1] + (vehicle.offsetLng || 0)]);

    const speed = Math.min(0.16, Math.max(0.01, (coords.length - 1) / ANIM_TARGET_FRAMES));

    function step()
    {
        if (vehicle.seg >= coords.length - 1)
        {
            vehicle.arrived = true;
            if (vehicle.visible) map.removeLayer(vehicle.marker);
            addLog(`Vehicle ${vehicle.num} arrived at ${vehicle.dest}.`, 'success');
            return;
        }
        const A = coords[vehicle.seg], B = coords[vehicle.seg + 1];
        vehicle.marker.setLatLng([
            A[0] + (B[0] - A[0]) * vehicle.t + (vehicle.offsetLat || 0),
            A[1] + (B[1] - A[1]) * vehicle.t + (vehicle.offsetLng || 0)
        ]);
        const el = vehicle.marker.getElement();
        if (el)
        {
            const iconDiv = el.querySelector('.truck-icon');
            if (iconDiv) iconDiv.style.transform = B[1] < A[1] ? 'scaleX(-1)' : 'scaleX(1)';
        }
        vehicle.t += speed;
        if (vehicle.t >= 1) { vehicle.t = 0; vehicle.seg++; }
        vehicle.animId = requestAnimationFrame(step);
    }
    vehicle.animId = requestAnimationFrame(step);
}

function addVehicleToTrip(trip, pathIds, cost)
{
    const color = routeColors[(vehicleCounter) % routeColors.length];
    const num = ++vehicleCounter;
    const latlngs = buildDenseRoute(pathIds);

    const bgLine = L.polyline(latlngs, { color, weight: 14, opacity: 0.16, lineCap: 'round' });
    const rLine  = L.polyline(latlngs, { color, weight: 6, opacity: 0.95, lineCap: 'round', lineJoin: 'round' });
    const icon = L.divIcon({
        className: '',
        html: `<div class="truck-icon" style="color:${color};filter: drop-shadow(0 0 8px ${color});">${SVG.truck}</div>`,
        iconSize: [30, 30], iconAnchor: [15, 15]
    });
    const marker = L.marker(latlngs[0], { icon, zIndexOffset: 1200 });

    const vehicle = {
        num, pathIds, cost: cost || 0, color,
        src: pathIds[0], dest: pathIds[pathIds.length - 1],
        bgLine, rLine, marker, seg: 0, t: 0, animId: null,
        offsetLat: (((num % 5) - 2) * 0.00008),
        offsetLng: (((num % 5) - 2) * -0.00016),
        visible: false, arrived: false,
    };
    trip.vehicles.push(vehicle);
    activeVehicles.push(vehicle);
    animateVehicle(vehicle);
    return vehicle;
}

function rebuildVehiclePath(vehicle, pathIds, cost)
{
    const latlngs = buildDenseRoute(pathIds);
    vehicle.pathIds = pathIds;
    vehicle.cost = cost || vehicle.cost;
    vehicle.dest = pathIds[pathIds.length - 1];
    vehicle.arrived = false;
    vehicle.bgLine.setLatLngs(latlngs);
    vehicle.rLine.setLatLngs(latlngs);
    if (!map.hasLayer(vehicle.marker) && vehicle.visible) vehicle.marker.addTo(map);
    animateVehicle(vehicle);
}

function setVehicleVisible(vehicle, visible)
{
    vehicle.visible = visible;
    const layers = [vehicle.bgLine, vehicle.rLine];
    if (!vehicle.arrived) layers.push(vehicle.marker);
    layers.forEach(l => {
        if (visible) { if (!map.hasLayer(l)) l.addTo(map); }
        else if (map.hasLayer(l)) map.removeLayer(l);
    });
}

function applyTripVisibility()
{
    trips.forEach(trip => {
        trip.vehicles.forEach(v => {
            let visible;
            if (showAllTrips) visible = true;
            else if (trip.id !== selectedTripId) visible = false;
            else if (selectedVehicleNum !== null) visible = (v.num === selectedVehicleNum);
            else visible = true;
            setVehicleVisible(v, visible);
        });
    });
}

function selectTrip(tripId, vehicleNum = null)
{
    selectedTripId = tripId;
    selectedVehicleNum = vehicleNum;
    showAllTrips = false;
    applyTripVisibility();
    renderRoutesPanel();
}
function selectAllTrips()
{
    showAllTrips = true;
    selectedVehicleNum = null;
    applyTripVisibility();
    renderRoutesPanel();
}

function renderRoutesPanel()
{
    const listEl = document.getElementById('routes-list');
    const countEl = document.getElementById('routes-count');
    const allBtn = document.getElementById('routes-showall');
    if (!listEl) return;

    countEl.textContent = trips.length;
    allBtn.classList.toggle('active', showAllTrips);

    if (!trips.length)
    {
        listEl.innerHTML = '<div class="empty-legend">No routes yet. Dispatch a fleet to begin.</div>';
        return;
    }

    listEl.innerHTML = trips.map(trip => {
        const isSel = !showAllTrips && trip.id === selectedTripId;
        const vehiclesHtml = isSel ? `
            <div class="route-vehicles">
                ${trip.vehicles.map(v => `
                    <div class="route-vehicle ${selectedVehicleNum === v.num ? 'active' : ''}" data-trip="${trip.id}" data-veh="${v.num}">
                        <span class="rv-dot" style="background:${v.color}"></span>
                        <span class="rv-name">Truck ${v.num}${v.arrived ? ' ✓' : ''}</span>
                        <span class="rv-cost">${ic('ruler', 11)} ${v.cost.toFixed(0)} km</span>
                    </div>`).join('')}
            </div>` : '';
        return `
            <div class="route-card ${isSel ? 'selected' : ''}" data-trip="${trip.id}">
                <div class="route-card-head" data-trip="${trip.id}">
                    <span class="route-swatch" style="background:${trip.color}"></span>
                    <span class="route-title">${trip.label}</span>
                    <span class="route-badge">×${trip.vehicles.length}</span>
                </div>
                ${vehiclesHtml}
            </div>`;
    }).join('');
    refreshIcons();

    listEl.querySelectorAll('.route-card-head').forEach(head => {
        head.addEventListener('click', () => {
            const id = parseInt(head.dataset.trip);
            selectTrip(id, null);   
        });
    });

    listEl.querySelectorAll('.route-vehicle').forEach(row => {
        row.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(row.dataset.trip);
            const veh = parseInt(row.dataset.veh);

            if (selectedTripId === id && selectedVehicleNum === veh) selectTrip(id, null);
            else selectTrip(id, veh);
        });
    });
}

async function fetchRoute(src, dst, algorithm, strategy)
{
    const res = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: src, destination: dst, algorithm, strategy })
    });
    return res.json();
}

async function fetchMultiStopRoute(stops, algorithm, strategy)
{
    const fullPath = [];
    let totalCost = 0;
    for (let i = 0; i < stops.length - 1; i++)
    {
        const seg = await fetchRoute(stops[i], stops[i + 1], algorithm, strategy);
        if (!seg.success) return { success: false, error: `${stops[i]} → ${stops[i + 1]}: ${seg.error}` };
        totalCost += seg.base_cost || 0;
        const segPath = (i === 0) ? seg.path : seg.path.slice(1);
        fullPath.push(...segPath);
    }
    return { success: true, path: fullPath, base_cost: totalCost };
}

document.getElementById('route-btn').addEventListener('click', async () =>
{
    const algoNames = { astar: 'A*', dijkstra: 'Dijkstra', bellman_ford: 'Bellman-Ford', greedy_bfs: 'Weighted A*' };
    const algorithm = document.getElementById('algorithm-select').value;
    const defaultStrategy = document.getElementById('strategy-select').value;

    if (multiStopMode)
    {
        if (waypoints.length < 2)
        {
            alert('Add at least two stops on the map first (multi-stop mode).');
            return;
        }
    } else if (!sourceNode || !destNode)
    {
        alert('Please select a Source and a Destination on the map first!');
        return;
    }
    if (vizState.active) vizExit();   

    const fleetSize = parseInt(document.getElementById('fleet-size').value) || 1;
    const perVehicleEnabled = document.getElementById('per-vehicle-toggle').checked && fleetSize > 1;
    const btn = document.getElementById('route-btn');
    btn.innerHTML = `${ic('loader')} Dispatching ${fleetSize} vehicle(s)...`; refreshIcons();
    btn.disabled = true;

    const routeLabel = multiStopMode ? waypoints.join(' → ') : `${sourceNode} → ${destNode}`;
    addLog(`Fleet dispatch: ${fleetSize}x via ${algoNames[algorithm] || algorithm} ${perVehicleEnabled ? '[per-vehicle strategy]' : '[' + defaultStrategy + ']'}: ${routeLabel}`, 'dispatch');

    const trip = {
        id: ++tripCounter,
        label: routeLabel,
        src: multiStopMode ? waypoints[0] : sourceNode,
        dst: multiStopMode ? waypoints[waypoints.length - 1] : destNode,
        algorithm,
        color: routeColors[(tripCounter - 1) % routeColors.length],
        vehicles: [],
    };

    let firstPath = null;
    for (let i = 0; i < fleetSize; i++)
    {
        let strategy = defaultStrategy;
        if (perVehicleEnabled)
        {
            const sel = document.querySelector(`.pv-select[data-vehicle="${i + 1}"]`);
            if (sel) strategy = sel.value;
        }

        const data = multiStopMode
            ? await fetchMultiStopRoute(waypoints, algorithm, strategy)
            : await fetchRoute(sourceNode, destNode, algorithm, strategy);

        if (data.success)
        {
            const pathStr = data.path.join(' → ');
            const costStr = data.base_cost !== undefined ? ` [${kmLabel(data.base_cost)}]` : '';
            const v = addVehicleToTrip(trip, data.path, data.base_cost);
            addLog(`V${v.num}${costStr}: ${pathStr}`, 'system');
            if (!firstPath) { firstPath = pathStr; statsData.uniqueRoutes = Math.max(1, statsData.uniqueRoutes); }
            else if (pathStr !== firstPath) { addLog(`Load-balancer redistributed route to avoid congestion.`, 'reroute'); statsData.uniqueRoutes++; }
            totalVehicles++;
            await loadGraph();
            updateStats();
            updateConvergenceChart();
        } else
        {
            addLog(`No path found: ${data.error}`, 'blocked');
        }
        if (fleetSize > 1 && i < fleetSize - 1) await new Promise(r => setTimeout(r, 300));
    }

    if (trip.vehicles.length)
    {
        trips.push(trip);
        sessionLog.push(...trip.vehicles.map(v => ({ path: v.pathIds, color: v.color, vehicleNum: v.num, cost: v.cost })));
        selectTrip(trip.id);   
    }
    btn.innerHTML = `${ic('truck')} Dispatch Fleet`; refreshIcons();
    btn.disabled = false;
});

function clearAllTrips()
{
    activeVehicles.forEach(v => {
        if (v.animId) cancelAnimationFrame(v.animId);
        [v.bgLine, v.rLine, v.marker].forEach(l => { if (l && map.hasLayer(l)) map.removeLayer(l); });
    });
    trips = [];
    activeVehicles = [];
    selectedTripId = null;
    selectedVehicleNum = null;
    showAllTrips = false;
    renderRoutesPanel();
}

document.getElementById('reset-btn').addEventListener('click', async () =>
{
    clearAllTrips();
    totalVehicles = 0;
    statsData = { vehicles: 0, uniqueRoutes: 0, congested: 0, blocked: 0 };
    sessionLog.length = 0;
    resetConvergenceChart();
    if (vizState.active) { vizExit(); document.getElementById('viz-controls').style.display = 'none'; }
    await fetch('/api/reset', { method: 'POST' });
    addLog('Network reset. All congestion cleared.', 'system');
    await loadGraph();
    updateStats();
});

document.getElementById('locate-btn').addEventListener('click', () =>
{
    const btn = document.getElementById('locate-btn');
    btn.innerHTML = `${ic('loader')} Acquiring Signal...`; refreshIcons();
    if (!('geolocation' in navigator))
    {
        alert('Geolocation not supported on this device.');
        btn.innerHTML = `${ic('smartphone')} Sync Phone GPS`; refreshIcons();
        return;
    }
    navigator.geolocation.getCurrentPosition((pos) =>
    {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        let minDist = Infinity, closest = null;
        const userLatLng = L.latLng(lat, lng);
        graphData.nodes.forEach(node =>
        {
            const d = map.distance(userLatLng, L.latLng(node.lat, node.lng));
            if (d < minDist) { minDist = d; closest = node; }
        });
        map.flyTo([lat, lng], 9, { duration: 2.5, easeLinearity: 0.2 });
        const m = L.circleMarker([lat, lng], {
            radius: 8, fillColor: '#00f2fe', color: '#fff', weight: 2, opacity: 1, fillOpacity: 1
        }).addTo(map)
            .bindPopup(`<b>${SVG.pin} Your Location</b><br>Nearest hub: <b>${closest.id}</b>`)
            .openPopup();
        gpsMarkers.push(m);
        sourceNode = closest.id;
        updateUI();
        drawGraph();
        addLog(`GPS sync: nearest hub = ${closest.id} (set as source)`, 'dispatch');
        btn.innerHTML = `${ic('check')} Source: ${closest.id}`; refreshIcons();
        setTimeout(() => { btn.innerHTML = `${ic('smartphone')} Sync Phone GPS`; refreshIcons(); }, 4000);
    }, () =>
    {
        alert('Could not get location. Allow GPS access and try again.');
        btn.innerHTML = `${ic('smartphone')} Sync Phone GPS`; refreshIcons();
    });
});

document.querySelectorAll('.gps-btn-truck').forEach(btn =>
{
    btn.addEventListener('click', () =>
    {
        const truckNum = btn.dataset.truck;
        const lat = parseFloat(btn.dataset.lat);
        const lng = parseFloat(btn.dataset.lng);
        const cityName = btn.dataset.city;

        let minDist = Infinity, closest = null;
        const pos = L.latLng(lat, lng);
        graphData.nodes.forEach(node =>
        {
            const d = map.distance(pos, L.latLng(node.lat, node.lng));
            if (d < minDist) { minDist = d; closest = node; }
        });

        const icon = L.divIcon({
            className: '',
            html: `<div class="gps-truck-marker"><div class="gps-pulse"></div>${SVG.truck}</div>`,
            iconSize: [32, 32], iconAnchor: [16, 16]
        });
        const marker = L.marker([lat, lng], { icon, zIndexOffset: 900 }).addTo(map);
        marker.bindPopup(`<b>${SVG.truck} Truck ${truckNum}</b><br>Location: ${cityName}<br>Nearest hub: <b>${closest.id}</b>`);
        gpsMarkers.push(marker);
        map.flyTo([lat, lng], 8, { duration: 1.5 });
        addLog(`Truck ${truckNum} GPS synced at ${cityName} (hub: ${closest.id})`, 'dispatch');
        btn.innerHTML = `${ic('check')} Truck ${truckNum} — ${cityName}`; refreshIcons();
        btn.style.borderColor = '#00ff87';
        btn.style.color = '#00ff87';
    });
});

function computeRouteCost(path)
{
    let total = 0;
    for (let i = 0; i < path.length - 1; i++)
    {
        const u = path[i], v = path[i + 1];
        const edge = graphData.edges.find(e =>
            (e.source === u && e.target === v) || (e.source === v && e.target === u)
        );
        if (edge && !edge.obstacle) total += edge.base_cost || edge.cost;
    }
    return total;
}

document.getElementById('compare-btn').addEventListener('click', async () =>
{
    if (!sourceNode || !destNode)
    {
        alert('Please select a Source and a Destination on the map first!');
        return;
    }
    const numTrucks = parseInt(document.getElementById('sim-trucks').value) || 4;
    const btn = document.getElementById('compare-btn');
    btn.innerHTML = `${ic('loader')} Simulating...`; refreshIcons();
    btn.disabled = true;

    

    await fetch('/api/reset', { method: 'POST' });
    await loadGraph();
    const naiveRes = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: sourceNode, destination: destNode })
    });
    const naiveData = await naiveRes.json();
    const naiveBaseCost = naiveData.success ? computeRouteCost(naiveData.path) : 0;
    const naiveRoutes = naiveData.success
        ? Array.from({ length: numTrucks }, () => ({ path: naiveData.path, cost: naiveBaseCost }))
        : [];

    await fetch('/api/reset', { method: 'POST' });
    await loadGraph();
    const smartRoutes = [];
    for (let i = 0; i < numTrucks; i++)
    {
        const r = await fetch('/api/route', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: sourceNode, destination: destNode })
        });
        const d = await r.json();
        if (d.success) smartRoutes.push({ path: d.path, cost: computeRouteCost(d.path) });
    }

    await fetch('/api/reset', { method: 'POST' });
    await loadGraph();

    btn.innerHTML = `${ic('swords')} Compare: Smart vs Naive`; refreshIcons();
    btn.disabled = false;

    if (naiveRoutes.length === 0 || smartRoutes.length === 0)
    {
        alert('Error: could not calculate route. Make sure the source and destination are connected.');
        return;
    }

    const naiveUnique = new Set(naiveRoutes.map(r => r.path.join(','))).size;
    const smartUnique = new Set(smartRoutes.map(r => r.path.join(','))).size;
    const naiveTotal = naiveRoutes.reduce((s, r) => s + r.cost, 0);
    const smartTotal = smartRoutes.reduce((s, r) => s + r.cost, 0);

    const naiveDiv = document.getElementById('naive-routes');
    const smartDiv = document.getElementById('smart-routes');
    naiveDiv.innerHTML = '';
    smartDiv.innerHTML = '';

    naiveRoutes.forEach((route, i) =>
    {
        const div = document.createElement('div');
        div.className = 'route-entry';
        div.style.borderLeft = '3px solid #ff4757';
        div.innerHTML = `<b>Truck ${i + 1}:</b> ${route.path.join(' → ')}<br>
            <small style="color:#94a3b8">${ic('ruler', 12)} ${route.cost.toFixed(0)} km &nbsp;|&nbsp; ${ic('clock', 12)} ${toTime(route.cost)}h &nbsp;|&nbsp; ${ic('wallet', 12)} ~${toPrice(route.cost)} RON</small>`;
        naiveDiv.appendChild(div);
    });

    smartRoutes.forEach((route, i) =>
    {
        const div = document.createElement('div');
        div.className = 'route-entry';
        div.style.borderLeft = `3px solid ${routeColors[i % routeColors.length]}`;
        div.innerHTML = `<b>Truck ${i + 1}:</b> ${route.path.join(' → ')}<br>
            <small style="color:#94a3b8">${ic('ruler', 12)} ${route.cost.toFixed(0)} km &nbsp;|&nbsp; ${ic('clock', 12)} ${toTime(route.cost)}h &nbsp;|&nbsp; ${ic('wallet', 12)} ~${toPrice(route.cost)} RON</small>`;
        smartDiv.appendChild(div);
    });

    

    
    const CONGESTION_DELAY_PER_EXTRA = 0.35;
    const calculateRealCost = (routes) =>
    {
        let realTotalKm = 0;
        let penaltyKm = 0;
        const counts = {};

        routes.forEach(r =>
        {
            const key = r.path.join(',');
            counts[key] = (counts[key] || 0) + 1;
        });

        routes.forEach(r =>
        {
            const key = r.path.join(',');
            const duplicates = Math.max(0, (counts[key] || 1) - 1);
            const penaltyPct = duplicates * CONGESTION_DELAY_PER_EXTRA;
            const routePenalty = r.cost * penaltyPct;
            penaltyKm += routePenalty;
            realTotalKm += r.cost + routePenalty;
        });
        return { penaltyKm, realTotalKm };
    };

    const naiveMath = calculateRealCost(naiveRoutes);
    const smartMath = calculateRealCost(smartRoutes);

    document.getElementById('naive-unique').textContent = naiveUnique;
    const naiveSharedRatio = naiveRoutes.length > 0 ? (naiveRoutes.length - naiveUnique) / naiveRoutes.length : 0;
    const smartSharedRatio = smartRoutes.length > 0 ? (smartRoutes.length - smartUnique) / smartRoutes.length : 0;

    document.getElementById('naive-congestion').innerHTML =
        naiveSharedRatio >= 0.75
            ? '<span class="status-dot status-blocked"></span> VERY HIGH — Most trucks share roads'
            : naiveSharedRatio >= 0.35
                ? '<span class="status-dot status-congested"></span> Moderate'
                : '<span class="status-dot status-clear"></span> Low';
    document.getElementById('smart-unique').textContent = smartUnique;
    document.getElementById('smart-congestion').innerHTML =
        smartSharedRatio <= 0.25
            ? '<span class="status-dot status-clear"></span> LOW — Fleet spread across routes'
            : smartSharedRatio <= 0.5
                ? '<span class="status-dot status-congested"></span> Moderate'
                : '<span class="status-dot status-blocked"></span> High';

    const naiveTotalEl = document.getElementById('naive-total-cost');
    const smartTotalEl = document.getElementById('smart-total-cost');

    if (naiveTotalEl) naiveTotalEl.innerHTML = `
        <div style="font-size:11px;margin-bottom:4px;color:#94a3b8;">
            Base: ${naiveTotal.toFixed(0)} km | Congestion penalty: <span style="color:#ff4757">+${naiveMath.penaltyKm.toFixed(0)} km</span>
        </div>
        <strong style="color:#ff4757;font-size:14px;">
            REAL TOTAL: ${ic('ruler', 13)} ${naiveMath.realTotalKm.toFixed(0)} km | ${ic('clock', 13)} ${toTime(naiveMath.realTotalKm)}h | ${ic('wallet', 13)} ~${toPrice(naiveMath.realTotalKm)} RON
        </strong>`;

    if (smartTotalEl) smartTotalEl.innerHTML = `
        <div style="font-size:11px;margin-bottom:4px;color:#94a3b8;">
            Base: ${smartTotal.toFixed(0)} km | Congestion penalty: <span style="color:#00ff87">+${smartMath.penaltyKm.toFixed(0)} km</span>
        </div>
        <strong style="color:#00ff87;font-size:14px;">
            REAL TOTAL: ${ic('ruler', 13)} ${smartMath.realTotalKm.toFixed(0)} km | ${ic('clock', 13)} ${toTime(smartMath.realTotalKm)}h | ${ic('wallet', 13)} ~${toPrice(smartMath.realTotalKm)} RON
        </strong>`;

    const moneySaved = parseInt(toPrice(naiveMath.realTotalKm)) - parseInt(toPrice(smartMath.realTotalKm));
    const hoursSaved = (naiveMath.realTotalKm - smartMath.realTotalKm) / AVG_SPEED_KMH;
    const penaltyDropPct = naiveMath.penaltyKm > 0
        ? ((naiveMath.penaltyKm - smartMath.penaltyKm) / naiveMath.penaltyKm) * 100
        : 0;
    const smartIsBetter = smartMath.realTotalKm < naiveMath.realTotalKm;

    document.getElementById('modal-conclusion').textContent = smartIsBetter
        ? `Smart routing reduced total effective distance by ${(naiveMath.realTotalKm - smartMath.realTotalKm).toFixed(0)} km ` +
          `(${Math.max(0, penaltyDropPct).toFixed(0)}% less congestion penalty), saving about ${Math.max(0, moneySaved)} RON ` +
          `and ${Math.max(0, hoursSaved).toFixed(1)} hours for this dispatch.`
        : `For this specific pair of cities and truck count, both strategies are similar. ` +
          `Smart routing still improves route diversity (${smartUnique} vs ${naiveUnique}) and resilience to incidents.`;

    document.getElementById('compare-modal').classList.remove('hidden');
    refreshIcons();
    addLog(`Comparison: Naive=${naiveUnique} route(s), Smart=${smartUnique} unique route(s) for ${numTrucks} trucks.`, 'reroute');
});

document.getElementById('modal-close-btn').addEventListener('click', () =>
{
    document.getElementById('compare-modal').classList.add('hidden');
});

document.getElementById('heatmap-btn').addEventListener('click', async (e) =>
{
    heatmapActive = !heatmapActive;
    e.target.style.background = heatmapActive ? 'rgba(245, 158, 11, 0.5)' : 'rgba(245, 158, 11, 0.2)';

    const realTrafficCb = document.getElementById('heatmap-real-traffic');
    if (heatmapActive && realTrafficCb && realTrafficCb.checked)
    {
        addLog('Fetching real-world traffic for heatmap overlay...', 'system');
        try
        {
            const res = await fetch('/api/traffic/sync', { method: 'POST' });
            const data = await res.json();
            if (data.success && data.events.length > 0)
            {
                addLog(`TomTom overlay: ${data.events.length} congested segments added to heatmap.`, 'reroute');
                await loadGraph();
            }
        } catch (err)
        {
            addLog(`TomTom overlay error: ${err}`, 'blocked');
        }
    }
    drawGraph();
    addLog(`Congestion Heatmap ${heatmapActive ? 'Activated' : 'Deactivated'}.`, 'system');
});

document.getElementById('weather-btn').addEventListener('click', async () =>
{
    const btn = document.getElementById('weather-btn');
    btn.disabled = true;
    btn.innerHTML = `${ic('loader')} Simulating...`; refreshIcons();
    try
    {
        const res = await fetch('/api/weather', { method: 'POST' });
        const data = await res.json();
        if (data.success && data.events.length > 0)
        {
            addLog(`WEATHER ALERT: Severe conditions (+50% cost) on ${data.events.length} road segments!`, 'obstacle');
            await loadGraph();
        } else
        {
            addLog(`Weather is stable across the network.`, 'system');
        }
    } catch (err)
    {
        addLog(`Weather API error: ${err}`, 'obstacle');
    }
    btn.innerHTML = `<span class="icon">${ic('dices')}</span> Simulate Weather`; refreshIcons();
    btn.disabled = false;
});

document.getElementById('weather-real-btn').addEventListener('click', async () =>
{
    const btn = document.getElementById('weather-real-btn');
    btn.disabled = true;
    btn.innerHTML = `${ic('loader')} Querying ECMWF...`; refreshIcons();
    try
    {
        const res = await fetch('/api/weather/real', { method: 'POST' });
        const data = await res.json();
        if (data.success && data.events.length > 0)
        {
            const types = data.events.map(e => e.type).join(', ');
            addLog(`ECMWF Weather: ${data.events.length} segments affected (${types})!`, 'obstacle');
            data.events.forEach(e =>
            {
                const details = [];
                if (e.precipitation) details.push(`rain: ${e.precipitation}mm`);
                if (e.snowfall) details.push(`snow: ${e.snowfall}cm`);
                if (e.wind_speed) details.push(`wind: ${e.wind_speed}km/h`);
                addLog(`${e.source}↔${e.target}: ${e.type} (${details.join(', ')})`, 'system');
            });
            await loadGraph();
        } else
        {
            addLog(`ECMWF: No severe weather detected over Romania.`, 'system');
        }
    } catch (err)
    {
        addLog(`ECMWF API error: ${err}`, 'obstacle');
    }
    btn.innerHTML = `<span class="icon">${ic('globe')}</span> ECMWF Real Weather`; refreshIcons();
    btn.disabled = false;
});

document.getElementById('traffic-btn').addEventListener('click', async () =>
{
    const btn = document.getElementById('traffic-btn');
    btn.disabled = true;
    btn.innerHTML = `${ic('loader')} Syncing Real Traffic...`; refreshIcons();
    try
    {
        const res = await fetch('/api/traffic/sync', { method: 'POST' });
        const data = await res.json();
        if (data.success && data.events.length > 0)
        {
            addLog(`TomTom Sync: ${data.events.length} real congestion segments detected.`, 'obstacle');
            await loadGraph();

            
            for (let v of activeVehicles)
            {
                if (v.arrived) continue;
                const rr = await fetch('/api/route', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ source: v.src, destination: v.dest })
                });
                const d = await rr.json();
                if (d.success && d.path.join(',') !== v.pathIds.join(','))
                {
                    addLog(`Traffic reroute: Truck ${v.num} rerouted around congestion.`, 'reroute');
                    rebuildVehiclePath(v, d.path, d.base_cost);
                }
            }
            applyTripVisibility();
        } else
        {
            addLog(`TomTom Sync: Traffic is normal.`, 'system');
        }
    } catch (err)
    {
        addLog(`Traffic API error: ${err}`, 'blocked');
    }
    btn.innerHTML = `<span class="icon">${ic('traffic-cone')}</span> Live Traffic Sync`; refreshIcons();
    btn.disabled = false;
});

let convergenceChart = null;

function initConvergenceChart()
{
    const ctx = document.getElementById('convergence-chart').getContext('2d');
    convergenceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Route Diversity (%)',
                data: [],
                borderColor: '#00ff87',
                backgroundColor: 'rgba(0, 255, 135, 0.1)',
                borderWidth: 2,
                pointBackgroundColor: '#00ff87',
                pointRadius: 4,
                tension: 0.4,
                fill: true,
            }]
        },
        options: {
            animation: { duration: 400 },
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#94a3b8', font: { family: 'Outfit', size: 11 } } },
                tooltip: { callbacks: { label: (c) => ` ${c.parsed.y.toFixed(0)}% unique routes` } }
            },
            scales: {
                x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
                y: { min: 0, max: 100, ticks: { color: '#64748b', font: { size: 10 }, callback: (v) => v + '%' }, grid: { color: 'rgba(255,255,255,0.05)' } }
            }
        }
    });
}

function updateConvergenceChart()
{
    if (!convergenceChart) return;
    const diversity = totalVehicles > 0 ? (statsData.uniqueRoutes / totalVehicles * 100) : 0;
    convergenceChart.data.labels.push(`V${totalVehicles}`);
    convergenceChart.data.datasets[0].data.push(parseFloat(diversity.toFixed(1)));
    convergenceChart.update();
}

function resetConvergenceChart()
{
    if (!convergenceChart) return;
    convergenceChart.data.labels = [];
    convergenceChart.data.datasets[0].data = [];
    convergenceChart.update();
}

let scalabilityChart = null;

let benchmarkData = null;
let benchmarkMetric = 'explored';   

const ALGO_SERIES = [
    { key: 'dijkstra', label: 'Dijkstra (uninformed)', color: '#ff6b6b' },
    { key: 'astar', label: 'A* (heuristic)', color: '#00ff87' },
    { key: 'bellman_ford', label: 'Bellman-Ford', color: '#a29bfe' },
    { key: 'greedy_bfs', label: 'Weighted A* (greedy)', color: '#f6d365' },
];

function renderBenchmarkChart()
{
    if (!benchmarkData) return;
    const suffix = benchmarkMetric === 'explored' ? '_explored' : '_ms';
    const unit = benchmarkMetric === 'explored' ? ' cities' : ' ms';
    const labels = benchmarkData.map(d => `${d.trucks} trucks`);
    const dashPatterns = [[], [8, 4], [3, 3], [10, 3, 2, 3]];
    const pointStyles = ['circle', 'rectRounded', 'triangle', 'rectRot'];
    const datasets = ALGO_SERIES.map((s, idx) => ({
        label: s.label,
        data: benchmarkData.map(d => d[s.key + suffix]),
        borderColor: s.color,
        backgroundColor: s.color + '22',   
        borderWidth: 2.2,
        pointRadius: 4.5,
        pointHoverRadius: 6,
        pointStyle: pointStyles[idx % pointStyles.length],
        borderDash: dashPatterns[idx % dashPatterns.length],
        tension: 0.25,
        fill: false,
    }));

    document.getElementById('scalability-chart-wrap').style.display = 'block';
    if (scalabilityChart) scalabilityChart.destroy();
    const ctx = document.getElementById('scalability-chart').getContext('2d');
    scalabilityChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'nearest', axis: 'x', intersect: false },
            plugins: {
                legend: { labels: { color: '#94a3b8', font: { family: 'Outfit', size: 11 } } },
                title: {
                    display: true,
                    color: '#e2e8f0',
                    text: benchmarkMetric === 'explored'
                        ? 'Nodes explored to reach target (lower = more efficient)'
                        : 'Avg. computation time (ms)',
                    font: { family: 'Outfit', size: 12 },
                },
                tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y}${unit}` } }
            },
            scales: {
                x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
                y: { ticks: { color: '#64748b', font: { size: 10 }, callback: (v) => v + unit }, grid: { color: 'rgba(255,255,255,0.05)' } }
            }
        }
    });
}

document.getElementById('benchmark-btn').addEventListener('click', async () =>
{
    const btn = document.getElementById('benchmark-btn');
    btn.disabled = true;
    btn.innerHTML = `${ic('loader')} Running benchmark...`; refreshIcons();
    addLog('Running algorithms benchmark (nodes explored + timing)...', 'system');

    try
    {
        const src = sourceNode || 'Bucuresti';
        const dst = destNode || 'Suceava';
        const res = await fetch(`/api/scalability?source=${src}&destination=${dst}`);
        benchmarkData = await res.json();
        renderBenchmarkChart();
        document.getElementById('benchmark-metric-toggle').style.display = 'flex';

        const avgD = benchmarkData.reduce((a, d) => a + d.dijkstra_explored, 0) / benchmarkData.length;
        const avgA = benchmarkData.reduce((a, d) => a + d.astar_explored, 0) / benchmarkData.length;
        const pct = avgD > 0 ? Math.round((1 - avgA / avgD) * 100) : 0;
        addLog(`Benchmark done. A* explores ~${pct}% fewer cities than Dijkstra (${avgA.toFixed(1)} vs ${avgD.toFixed(1)}).`, 'success');
    } catch (err)
    {
        addLog(`Benchmark error: ${err}`, 'blocked');
    }

    btn.innerHTML = `${ic('microscope')} Run Algorithms Benchmark`; refreshIcons();
    btn.disabled = false;
});

document.querySelectorAll('.benchmark-metric-btn').forEach(b =>
{
    b.addEventListener('click', () =>
    {
        benchmarkMetric = b.dataset.metric;
        document.querySelectorAll('.benchmark-metric-btn').forEach(x => x.classList.toggle('active', x === b));
        renderBenchmarkChart();
    });
});

document.getElementById('replay-btn').addEventListener('click', () =>
{
    if (!trips.length)
    {
        alert('No session to replay. Dispatch some vehicles first!');
        return;
    }
    addLog(`Replaying session: ${trips.length} route(s)...`, 'system');
    trips.forEach((trip, i) =>
    {
        setTimeout(() =>
        {

            trip.vehicles.forEach(v => animateVehicle(v));
            selectTrip(trip.id, null);
            addLog(`Replay: ${trip.label} (×${trip.vehicles.length}).`, 'dispatch');
        }, i * 1500);
    });
});

document.getElementById('export-csv-btn').addEventListener('click', () =>
{
    if (sessionLog.length === 0)
    {
        alert('No routes to export. Dispatch some vehicles first!');
        return;
    }
    const headers = ['Vehicle', 'Algorithm', 'Source', 'Destination', 'Path', 'Distance (km)', 'Est. Time (h)', 'Fuel Cost (RON)'];
    const rows = sessionLog.map(r => [
        r.vehicleNum,
        'Smart A*',
        r.path[0],
        r.path[r.path.length - 1],
        r.path.join(' -> '),
        r.cost.toFixed(0),
        toTime(r.cost),
        toPrice(r.cost)
    ]);
    const csvContent = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\r\n');
    const blob = new Blob(['sep=,\r\n' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fleet-routing-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addLog(`Session exported as CSV (${sessionLog.length} routes).`, 'success');
});

document.getElementById('export-print-btn').addEventListener('click', () =>
{
    addLog('Opening print/PDF dialog...', 'system');
    window.print();
});

function renderVizFrame()
{
    if (!vizState.active || !vizState.frames.length) return;
    const frame = vizState.frames[vizState.step];
    const visited = new Set(frame.visited);
    const frontier = new Set(frame.frontier);
    const onPath = vizState.step === vizState.frames.length - 1
        ? new Set(vizState.path) : new Set();

    nodeLayers.forEach(layer =>
    {
        const id = layer._cityId;
        let color = '#3b82f6', fill = '#07090f', radius = 7, weight = 2;
        if (visited.has(id)) { color = '#64748b'; fill = '#334155'; }
        if (frontier.has(id)) { color = '#fbbf24'; fill = '#78350f'; radius = 9; }
        if (id === frame.current) { color = '#00ff87'; fill = '#065f46'; radius = 12; weight = 3; }
        if (onPath.has(id)) { color = '#00f2fe'; fill = '#0e7490'; radius = 10; weight = 3; }
        if (id === sourceNode) { color = '#00f2fe'; radius = 12; weight = 3; }
        if (id === destNode) { color = '#fe0979'; radius = 12; weight = 3; }
        layer.setStyle({ color, fillColor: fill, radius, weight });
    });

    if (vizState.step === vizState.frames.length - 1 && vizState.path.length > 1)
    {
        if (vizState._pathLine) map.removeLayer(vizState._pathLine);
        vizState._pathLine = L.polyline(buildDenseRoute(vizState.path),
            { color: '#00f2fe', weight: 5, opacity: 0.9, lineCap: 'round' }).addTo(map);
    } else if (vizState._pathLine)
    {
        map.removeLayer(vizState._pathLine);
        vizState._pathLine = null;
    }

    document.getElementById('viz-step').textContent = vizState.step + 1;
    document.getElementById('viz-total').textContent = vizState.frames.length;
    document.getElementById('viz-explored').textContent = frame.visited.length;
    document.getElementById('viz-slider').value = vizState.step;
}

function vizGoto(step)
{
    vizState.step = Math.max(0, Math.min(vizState.frames.length - 1, step));
    renderVizFrame();
}

function vizStopPlaying()
{
    vizState.playing = false;
    if (vizState.timer) { clearInterval(vizState.timer); vizState.timer = null; }
    const pb = document.getElementById('viz-play');
    pb.innerHTML = `${ic('play')} Play`; refreshIcons();
}

function vizExit()
{
    vizStopPlaying();
    vizState.active = false;
    if (vizState._pathLine) { map.removeLayer(vizState._pathLine); vizState._pathLine = null; }
    drawGraph();   
}

document.getElementById('viz-btn').addEventListener('click', async () =>
{
    if (!sourceNode || !destNode)
    {
        alert('Please select a Source and a Destination on the map first!');
        return;
    }
    const algorithm = document.getElementById('viz-algo-select').value;
    const algoNames = { astar: 'A*', dijkstra: 'Dijkstra', greedy_bfs: 'Weighted A*' };
    const btn = document.getElementById('viz-btn');
    btn.disabled = true;
    btn.innerHTML = `${ic('loader')} Computing...`; refreshIcons();

    try
    {
        const res = await fetch('/api/route/explore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: sourceNode, destination: destNode, algorithm, strategy: 'balanced' })
        });
        const data = await res.json();
        if (!data.frames || !data.frames.length)
        {
            addLog(`Visualizer: no path to explore.`, 'blocked');
        } else
        {
            vizState.active = true;
            vizState.frames = data.frames;
            vizState.path = data.path || [];
            vizState.explored = data.explored;
            vizState.step = 0;
            document.getElementById('viz-controls').style.display = 'block';
            const slider = document.getElementById('viz-slider');
            slider.max = data.frames.length - 1;
            renderVizFrame();
            addLog(`Visualizer: ${algoNames[algorithm] || algorithm} explored ${data.explored} cities to reach ${destNode}.`, 'reroute');
        }
    } catch (err)
    {
        addLog(`Visualizer error: ${err}`, 'blocked');
    }
    btn.innerHTML = `${ic('play-circle')} Visualize Exploration`; refreshIcons();
    btn.disabled = false;
});

document.getElementById('viz-slider').addEventListener('input', (e) =>
{
    vizStopPlaying();
    vizGoto(parseInt(e.target.value));
});
document.getElementById('viz-step-fwd').addEventListener('click', () => { vizStopPlaying(); vizGoto(vizState.step + 1); });
document.getElementById('viz-step-back').addEventListener('click', () => { vizStopPlaying(); vizGoto(vizState.step - 1); });
document.getElementById('viz-play').addEventListener('click', () =>
{
    if (vizState.playing) { vizStopPlaying(); return; }
    if (vizState.step >= vizState.frames.length - 1) vizState.step = 0;
    vizState.playing = true;
    const pb = document.getElementById('viz-play');
    pb.innerHTML = `${ic('pause')} Pause`; refreshIcons();
    vizState.timer = setInterval(() =>
    {
        if (vizState.step >= vizState.frames.length - 1) { vizStopPlaying(); return; }
        vizGoto(vizState.step + 1);
    }, 350);
});

function renderWaypointList()
{
    const list = document.getElementById('multistop-list');
    if (!waypoints.length)
    {
        list.innerHTML = '<div class="multistop-empty">No stops yet.</div>';
        return;
    }
    list.innerHTML = waypoints.map((city, i) =>
        `<div class="multistop-item">
            <span class="multistop-num">${i + 1}</span>
            <span class="multistop-city">${city}</span>
            <button class="multistop-remove" data-idx="${i}" title="Remove">${ic('x', 13)}</button>
        </div>`).join('');
    refreshIcons();
    list.querySelectorAll('.multistop-remove').forEach(btn =>
    {
        btn.addEventListener('click', () =>
        {
            waypoints.splice(parseInt(btn.dataset.idx), 1);
            renderWaypointList();
            drawGraph();
        });
    });
}

document.getElementById('multistop-toggle').addEventListener('change', (e) =>
{
    multiStopMode = e.target.checked;
    const show = multiStopMode ? 'block' : 'none';
    document.getElementById('multistop-hint').style.display = show;
    document.getElementById('multistop-list').style.display = show;
    document.getElementById('multistop-clear').style.display = multiStopMode ? 'inline-flex' : 'none';
    if (multiStopMode)
    {

        if (sourceNode && !waypoints.includes(sourceNode)) waypoints.push(sourceNode);
        if (destNode && !waypoints.includes(destNode)) waypoints.push(destNode);
        addLog('Multi-stop mode ON. Click cities in the order to visit.', 'system');
    } else
    {
        addLog('Multi-stop mode OFF.', 'system');
    }
    renderWaypointList();
    drawGraph();
});

document.getElementById('multistop-clear').addEventListener('click', () =>
{
    waypoints = [];
    renderWaypointList();
    drawGraph();
});

document.getElementById('routes-showall').addEventListener('click', () =>
{
    if (showAllTrips && trips.length)
    {

        selectTrip(trips[trips.length - 1].id, null);
    } else
    {
        selectAllTrips();
    }
});

function initCollapsiblePanels()
{
    document.querySelectorAll('#sidebar .panel').forEach(panel =>
    {
        const head = panel.querySelector('h3');
        if (!head) return;

        if (!panel.querySelector(':scope > .panel-body'))
        {
            const body = document.createElement('div');
            body.className = 'panel-body';
            let node = head.nextSibling;
            while (node) { const next = node.nextSibling; body.appendChild(node); node = next; }
            panel.appendChild(body);
        }
        head.classList.add('collapsible');
        head.insertAdjacentHTML('beforeend', '<i data-lucide="chevron-down" class="collapse-chevron"></i>');
        if (panel.dataset.collapsed === 'true') panel.classList.add('collapsed');
        head.addEventListener('click', (e) =>
        {

            if (e.target.closest('input, select, button, label')) return;
            panel.classList.toggle('collapsed');
        });
    });
    refreshIcons();
}

refreshIcons();          
initCollapsiblePanels();
initConvergenceChart();
renderRoutesPanel();
loadGraph();
