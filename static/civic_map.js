// WardWiseCivicMap: a light SVG map of Chicago's wards or community areas for the proposal
// pages. It draws, colors, hovers and selects; what the colors mean is the caller's business.
// No Leaflet here on purpose: the audience pages want a clean shape of the city, not tiles.
(function () {
  const api = window.WardWiseExplorer;
  const esc = (value) => api.escapeHtml(value);
  const SVG = "http://www.w3.org/2000/svg";
  const WIDTH = 600;

  const geometry = {};

  // Features for one geography, projected once and cached. Chicago is small enough that an
  // equirectangular projection scaled by cos(latitude) is indistinguishable from a real one.
  function loadGeometry(areaType) {
    if (!geometry[areaType]) {
      const fetcher = areaType === "ward" ? api.fetchWardGeojson() : api.fetchCommunityAreaGeojson();
      geometry[areaType] = fetcher.then((collection) => project(collection.features, areaType));
    }
    return geometry[areaType];
  }

  function rings(geom) {
    if (geom.type === "Polygon") return geom.coordinates;
    if (geom.type === "MultiPolygon") return geom.coordinates.flat();
    return [];
  }

  function project(features, areaType) {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    features.forEach((feature) => rings(feature.geometry).forEach((ring) => ring.forEach(([lon, lat]) => {
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    })));
    const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const scale = WIDTH / ((maxLon - minLon) * k);
    const height = (maxLat - minLat) * scale;
    const point = ([lon, lat]) => `${((lon - minLon) * k * scale).toFixed(1)},${((maxLat - lat) * scale).toFixed(1)}`;
    const areas = features.map((feature) => {
      const props = feature.properties || {};
      const id = areaType === "ward" ? String(props.ward_id).padStart(2, "0") : String(props.community_area_id).padStart(2, "0");
      const name = areaType === "ward" ? `Ward ${Number(props.ward_number || props.ward_id)}` : (props.display_name || props.name);
      const d = rings(feature.geometry).map((ring) => `M${ring.map(point).join("L")}Z`).join("");
      return { id, name, d };
    });
    return { areas, width: WIDTH, height: Math.round(height) };
  }

  // Build a map inside `container`. Options:
  //   areaType     "ward" | "community_area"
  //   onSelect(id) called on click or Enter
  //   tooltip(id)  returns HTML for the hover card, or null for none
  //   label        accessible name for the whole map
  async function create(container, options) {
    const { areaType, onSelect, tooltip, label } = options;
    const geo = await loadGeometry(areaType);

    container.innerHTML = "";
    container.classList.add("cm");
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", `0 0 ${geo.width} ${geo.height}`);
    svg.setAttribute("class", "cm-svg");
    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", label || "Map of Chicago");
    const layer = document.createElementNS(SVG, "g");
    svg.appendChild(layer);

    const tip = document.createElement("div");
    tip.className = "cm-tip";
    tip.hidden = true;
    container.append(svg, tip);

    const paths = new Map();
    let selected = null;

    geo.areas.forEach((area) => {
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("d", area.d);
      path.setAttribute("class", "cm-area");
      path.setAttribute("tabindex", "0");
      path.setAttribute("role", "button");
      path.setAttribute("aria-label", area.name);
      path.dataset.id = area.id;
      layer.appendChild(path);
      paths.set(area.id, path);
    });

    // Each shape gets a delay from its north-south position, so the city draws in from the
    // lake's north end down to the south side, and recolors in the same wave.
    paths.forEach((path) => {
      const box = path.getBBox();
      const place = (box.y + box.height / 2) / geo.height;
      path.style.setProperty("--cm-delay", `${Math.round(place * 420)}ms`);
    });
    container.classList.add("is-entering");
    setTimeout(() => container.classList.remove("is-entering"), 1200);

    function raise(path) {
      // SVG paints in document order, so an outline only shows fully on the last child.
      layer.appendChild(path);
      if (selected && paths.get(selected) !== path) layer.appendChild(paths.get(selected));
    }

    function showTip(path, event) {
      const html = tooltip ? tooltip(path.dataset.id) : null;
      if (!html) {
        tip.hidden = true;
        return;
      }
      tip.innerHTML = html;
      tip.hidden = false;
      const box = container.getBoundingClientRect();
      const x = event ? event.clientX - box.left : path.getBoundingClientRect().left - box.left + path.getBoundingClientRect().width / 2;
      const y = event ? event.clientY - box.top : path.getBoundingClientRect().top - box.top;
      const flip = x > box.width * 0.6;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
      tip.classList.toggle("is-left", flip);
    }

    layer.addEventListener("pointermove", (event) => {
      const path = event.target.closest(".cm-area");
      if (!path) return;
      if (!path.classList.contains("is-hover")) {
        layer.querySelectorAll(".is-hover").forEach((el) => el.classList.remove("is-hover"));
        path.classList.add("is-hover");
        raise(path);
      }
      showTip(path, event);
    });
    layer.addEventListener("pointerleave", () => {
      layer.querySelectorAll(".is-hover").forEach((el) => el.classList.remove("is-hover"));
      tip.hidden = true;
    });
    layer.addEventListener("click", (event) => {
      const path = event.target.closest(".cm-area");
      if (path && onSelect) onSelect(path.dataset.id);
    });
    layer.addEventListener("keydown", (event) => {
      const path = event.target.closest(".cm-area");
      if (!path || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      if (onSelect) onSelect(path.dataset.id);
    });
    layer.addEventListener("focusin", (event) => {
      const path = event.target.closest(".cm-area");
      if (path) showTip(path, null);
    });
    layer.addEventListener("focusout", () => { tip.hidden = true; });

    return {
      areas: geo.areas,
      // fill(id) returns a CSS color, or null for "no data".
      paint(fill) {
        tip.hidden = true;
        paths.forEach((path, id) => {
          const color = fill(id);
          path.style.fill = color || "";
          path.classList.toggle("is-empty", !color);
        });
      },
      select(id) {
        if (selected) paths.get(selected)?.classList.remove("is-selected");
        selected = id && paths.has(id) ? id : null;
        if (selected) {
          const path = paths.get(selected);
          path.classList.add("is-selected");
          path.setAttribute("aria-pressed", "true");
          layer.appendChild(path);
        }
        paths.forEach((path, pathId) => { if (pathId !== selected) path.removeAttribute("aria-pressed"); });
      },
      nameOf(id) {
        return geo.areas.find((area) => area.id === id)?.name || "";
      },
    };
  }

  window.WardWiseCivicMap = { create, loadGeometry, esc };
})();
