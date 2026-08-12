/* cad-engine.js — STL part analysis + optional Three.js viewer.
   Analysis core is pure JS (works without THREE). Viewer is an enhancement.
   Exposed as window.CadEngine. */
(function () {
  'use strict';

  // ---------- small vec helpers (flat arrays) ----------
  function sub(a, b, o) { return [a[o] - b[0], a[o + 1] - b[1], a[o + 2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function len(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }

  // ================= STL PARSING =================
  function parseSTL(buf) {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    // Read a generous header chunk as text for keyword sniffing
    let head = '';
    for (let i = 0; i < Math.min(512, buf.byteLength); i++) head += String.fromCharCode(u8[i]);
    const looksAscii = /^\s*solid/i.test(head) && /\b(facet|vertex|endloop|outer)\b/i.test(head);
    // Binary is valid only if the triangle count fits the file size exactly
    let binaryExact = false;
    if (buf.byteLength >= 84) {
      const n = dv.getUint32(80, true);
      if (n > 0 && 84 + n * 50 === buf.byteLength) binaryExact = true;
    }
    // Prefer the format we can verify
    if (binaryExact && !looksAscii) return parseBinary(dv);
    if (looksAscii) {
      const a = parseAscii(u8);
      if (a.length) return a;
    }
    if (binaryExact) return parseBinary(dv);
    // Ambiguous: try a bounds-safe binary read, fall back to ASCII text scan
    if (buf.byteLength >= 84) {
      const b = parseBinary(dv);
      if (b.length) return b;
    }
    return parseAscii(u8);
  }

  function parseBinary(dv) {
    const n = dv.getUint32(80, true);
    // Clamp to whatever actually fits so a bad count can never read out of bounds
    const maxN = Math.max(0, Math.floor((dv.byteLength - 84) / 50));
    const count = Math.min(n, maxN);
    const positions = new Float32Array(count * 9);
    let p = 84, k = 0;
    for (let i = 0; i < count; i++) {
      p += 12; // skip normal
      for (let v = 0; v < 9; v++) { positions[k++] = dv.getFloat32(p, true); p += 4; }
      p += 2; // attribute byte count
    }
    return positions;
  }

  function parseAscii(u8) {
    let s = '';
    // decode (may be large) in chunks
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, u8.length)));
    }
    const verts = [];
    const re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
    let m;
    while ((m = re.exec(s))) { verts.push(+m[1], +m[2], +m[3]); }
    return new Float32Array(verts);
  }

  // ================= ENGINE =================
  class CadEngine {
    constructor(host, opts) {
      this.host = host;
      this.opts = opts || {};
      this.positions = null;     // centered Float32Array (9 per tri)
      this.F = 0;
      this.center = [0, 0, 0];   // original-space centroid of bbox (for re-offset)
      this.bvh = null;
      this.three = null;         // {scene,camera,renderer,mesh,...}
      this._raf = null;
      this._disposed = false;
    }

    // ----- load -----
    load(arrayBuffer) {
      const raw = parseSTL(arrayBuffer);
      this.F = (raw.length / 9) | 0;
      if (this.F < 1) throw new Error('No triangles found — not a valid STL file.');
      // bbox in original space
      let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
      for (let i = 0; i < raw.length; i += 3) {
        const x = raw[i], y = raw[i + 1], z = raw[i + 2];
        if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z;
        if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z;
      }
      this.bboxOrig = { min: [mnx, mny, mnz], max: [mxx, mxy, mxz] };
      this.center = [(mnx + mxx) / 2, (mny + mxy) / 2, (mnz + mxz) / 2];
      // center the geometry at origin (distances/areas/volumes invariant)
      const pos = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i += 3) {
        pos[i] = raw[i] - this.center[0];
        pos[i + 1] = raw[i + 1] - this.center[1];
        pos[i + 2] = raw[i + 2] - this.center[2];
      }
      this.positions = pos;
      this._computeFaceData();
      this.bvh = null; // lazy
      return this.metrics();
    }

    _computeFaceData() {
      const pos = this.positions, F = this.F;
      const nrm = new Float32Array(F * 3);
      const cen = new Float32Array(F * 3);
      const area = new Float32Array(F);
      for (let f = 0; f < F; f++) {
        const o = f * 9;
        const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
        const bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5];
        const cx = pos[o + 6], cy = pos[o + 7], cz = pos[o + 8];
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        let nx = e1y * e2z - e1z * e2y;
        let ny = e1z * e2x - e1x * e2z;
        let nz = e1x * e2y - e1y * e2x;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1e-12;
        area[f] = 0.5 * l;
        nrm[f * 3] = nx / l; nrm[f * 3 + 1] = ny / l; nrm[f * 3 + 2] = nz / l;
        cen[f * 3] = (ax + bx + cx) / 3; cen[f * 3 + 1] = (ay + by + cy) / 3; cen[f * 3 + 2] = (az + bz + cz) / 3;
      }
      this.faceN = nrm; this.faceC = cen; this.faceA = area;
    }

    // ----- base metrics -----
    metrics() {
      const pos = this.positions, F = this.F, area = this.faceA;
      let surf = 0, vol6 = 0;
      let cgx = 0, cgy = 0, cgz = 0; // weighted by signed tetra vol
      for (let f = 0; f < F; f++) {
        surf += area[f];
        const o = f * 9;
        const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
        const bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5];
        const cx = pos[o + 6], cy = pos[o + 7], cz = pos[o + 8];
        // signed volume of tetra (origin, a, b, c) * 6
        const v6 = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
        vol6 += v6;
        // tetra centroid = (a+b+c+0)/4, weight by v6
        cgx += v6 * (ax + bx + cx) / 4;
        cgy += v6 * (ay + by + cy) / 4;
        cgz += v6 * (az + bz + cz) / 4;
      }
      const vol = Math.abs(vol6) / 6;
      const com = vol6 !== 0
        ? [cgx / vol6 + this.center[0], cgy / vol6 + this.center[1], cgz / vol6 + this.center[2]]
        : [this.center[0], this.center[1], this.center[2]];
      const bb = this.bboxOrig;
      return {
        triangles: F,
        surfaceArea: surf,            // mm^2
        volume: vol,                  // mm^3
        bbox: { min: bb.min.slice(), max: bb.max.slice(),
                size: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]] },
        centerOfMass: com,
        watertight: this._watertightHint()
      };
    }

    // cheap closed-mesh hint: |signed volume|/boundingVol sanity + normal balance
    _watertightHint() {
      // sum of area*normal should be ~0 for a closed surface
      const F = this.F, nrm = this.faceN, area = this.faceA;
      let sx = 0, sy = 0, sz = 0, tot = 0;
      for (let f = 0; f < F; f++) { sx += nrm[f * 3] * area[f]; sy += nrm[f * 3 + 1] * area[f]; sz += nrm[f * 3 + 2] * area[f]; tot += area[f]; }
      const imbalance = Math.sqrt(sx * sx + sy * sy + sz * sz) / (tot || 1);
      return imbalance < 0.01;
    }

    // ----- projected (silhouette) area via rasterization, accurate for locking force -----
    // axis: 0=X,1=Y,2=Z (draw direction). Returns {area, fillImage, dims}
    projectedArea(axis, res) {
      res = res || 700;
      const pos = this.positions, F = this.F;
      // pick the two in-plane axes
      const ai = [[1, 2], [0, 2], [0, 1]][axis];
      const u = ai[0], v = ai[1];
      const bb = this.bboxOrig;
      const minU = bb.min[u] - this.center[u], maxU = bb.max[u] - this.center[u];
      const minV = bb.min[v] - this.center[v], maxV = bb.max[v] - this.center[v];
      const spanU = (maxU - minU) || 1, spanV = (maxV - minV) || 1;
      // square-ish cells
      const W = res, H = Math.max(8, Math.round(res * spanV / spanU));
      const cellU = spanU / W, cellV = spanV / H;
      const grid = new Uint8Array(W * H);
      // scanline-fill each triangle's projection
      for (let f = 0; f < F; f++) {
        const o = f * 9;
        const x0 = (pos[o + u] - minU) / cellU, y0 = (pos[o + v] - minV) / cellV;
        const x1 = (pos[o + 3 + u] - minU) / cellU, y1 = (pos[o + 3 + v] - minV) / cellV;
        const x2 = (pos[o + 6 + u] - minU) / cellU, y2 = (pos[o + 6 + v] - minV) / cellV;
        let yMin = Math.floor(Math.min(y0, y1, y2)), yMax = Math.ceil(Math.max(y0, y1, y2));
        if (yMin < 0) yMin = 0; if (yMax > H) yMax = H;
        let xMinB = Math.floor(Math.min(x0, x1, x2)), xMaxB = Math.ceil(Math.max(x0, x1, x2));
        if (xMinB < 0) xMinB = 0; if (xMaxB > W) xMaxB = W;
        // barycentric per-cell test (triangles usually small)
        const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
        if (Math.abs(d) < 1e-9) continue;
        for (let yy = yMin; yy < yMax; yy++) {
          const py = yy + 0.5;
          for (let xx = xMinB; xx < xMaxB; xx++) {
            const px = xx + 0.5;
            const a = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / d;
            const b = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / d;
            const c = 1 - a - b;
            if (a >= 0 && b >= 0 && c >= 0) grid[yy * W + xx] = 1;
          }
        }
      }
      let covered = 0;
      for (let i = 0; i < grid.length; i++) covered += grid[i];
      const cellArea = cellU * cellV;
      return { area: covered * cellArea, W, H, grid, cellU, cellV };
    }

    // ----- draft / undercut analysis relative to draw axis -----
    // returns per-face class: 0 ok-positive, 1 ok-negative, 2 low-draft, 3 undercut
    draftAnalysis(axis, minDraftDeg) {
      const F = this.F, nrm = this.faceN, area = this.faceA;
      const ax = [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0];
      const cls = new Uint8Array(F);
      const thr = Math.sin((minDraftDeg || 1) * Math.PI / 180); // |n·axis| below => low draft
      let lowArea = 0, posArea = 0, negArea = 0, totArea = 0, minDraft = 90;
      for (let f = 0; f < F; f++) {
        const nd = nrm[f * 3] * ax[0] + nrm[f * 3 + 1] * ax[1] + nrm[f * 3 + 2] * ax[2];
        const a = Math.abs(nd);
        const draftDeg = Math.asin(Math.min(1, a)) * 180 / Math.PI;
        totArea += area[f];
        if (a < thr) { cls[f] = 2; lowArea += area[f]; if (draftDeg < minDraft) minDraft = draftDeg; }
        else if (nd > 0) { cls[f] = 0; posArea += area[f]; }
        else { cls[f] = 1; negArea += area[f]; }
      }
      return { cls, lowDraftAreaPct: totArea ? lowArea / totArea * 100 : 0,
        coverPct: totArea ? posArea / totArea * 100 : 0, ejectorPct: totArea ? negArea / totArea * 100 : 0,
        minDraftDeg: minDraft, axis };
    }

    // chunked undercut detection: a face is an undercut if, pulled along its mold-half
    // draw direction, it is blocked by part material. Mutates cls (sets 3) in place.
    runUndercut(axis, cls, area, onProgress, done) {
      this.buildBVH();
      const F = this.F, cen = this.faceC, nrm = this.faceN;
      const ax = [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0];
      const span = Math.max(
        this.bboxOrig.max[0] - this.bboxOrig.min[0],
        this.bboxOrig.max[1] - this.bboxOrig.min[1],
        this.bboxOrig.max[2] - this.bboxOrig.min[2]) * 1.5;
      let f = 0, ucArea = 0, ucCount = 0, totArea = 0;
      for (let i = 0; i < F; i++) totArea += area[i];
      const self = this, chunk = 4000;
      function work() {
        if (self._disposed) return;
        const end = Math.min(F, f + chunk);
        for (; f < end; f++) {
          const nd = nrm[f * 3] * ax[0] + nrm[f * 3 + 1] * ax[1] + nrm[f * 3 + 2] * ax[2];
          if (Math.abs(nd) < 0.087) continue; // ~5°: near-vertical handled by draft
          const dir = nd > 0 ? 1 : -1; // pull direction along axis
          const dx = ax[0] * dir, dy = ax[1] * dir, dz = ax[2] * dir;
          const ox = cen[f * 3] + dx * 1e-3, oy = cen[f * 3 + 1] + dy * 1e-3, oz = cen[f * 3 + 2] + dz * 1e-3;
          const t = self.raycast(ox, oy, oz, dx, dy, dz, f, false); // front faces only
          if (isFinite(t) && t < span) { cls[f] = 3; ucArea += area[f]; ucCount++; }
        }
        if (onProgress) onProgress(f / F);
        if (f < F) self._raf3 = requestAnimationFrame(work);
        else done && done({ undercutAreaPct: totArea ? ucArea / totArea * 100 : 0, undercutCount: ucCount });
      }
      work();
    }

    // ================= BVH (for wall thickness) =================
    buildBVH(leafSize) {
      if (this.bvh) return this.bvh;
      leafSize = leafSize || 6;
      const F = this.F, pos = this.positions, cen = this.faceC;
      const idx = new Uint32Array(F);
      for (let i = 0; i < F; i++) idx[i] = i;
      const maxNodes = 2 * F + 1;
      const nMin = new Float32Array(maxNodes * 3), nMax = new Float32Array(maxNodes * 3);
      const nLeft = new Int32Array(maxNodes), nCount = new Int32Array(maxNodes), nStart = new Int32Array(maxNodes);
      let nodeCount = 0;

      function nodeBounds(node, first, count) {
        let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
        for (let i = 0; i < count; i++) {
          const t = idx[first + i], o = t * 9;
          for (let k = 0; k < 3; k++) {
            const x = pos[o + k * 3], y = pos[o + k * 3 + 1], z = pos[o + k * 3 + 2];
            if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z;
            if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z;
          }
        }
        nMin[node * 3] = mnx; nMin[node * 3 + 1] = mny; nMin[node * 3 + 2] = mnz;
        nMax[node * 3] = mxx; nMax[node * 3 + 1] = mxy; nMax[node * 3 + 2] = mxz;
      }

      // iterative build using a stack to avoid recursion limits on big meshes
      const stack = [];
      const root = nodeCount++;
      nStart[root] = 0; nCount[root] = F; nLeft[root] = -1;
      nodeBounds(root, 0, F);
      stack.push(root);
      while (stack.length) {
        const node = stack.pop();
        const first = nStart[node], count = nCount[node];
        if (count <= leafSize) continue;
        // split along largest centroid extent
        let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
        for (let i = 0; i < count; i++) {
          const t = idx[first + i];
          const x = cen[t * 3], y = cen[t * 3 + 1], z = cen[t * 3 + 2];
          if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z;
          if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z;
        }
        const ex = mxx - mnx, ey = mxy - mny, ez = mxz - mnz;
        let axisB = 0, split = mnx + ex * 0.5;
        if (ey >= ex && ey >= ez) { axisB = 1; split = mny + ey * 0.5; }
        else if (ez >= ex && ez >= ey) { axisB = 2; split = mnz + ez * 0.5; }
        // partition
        let i = first, j = first + count - 1;
        while (i <= j) {
          const ci = cen[idx[i] * 3 + axisB];
          if (ci < split) i++;
          else { const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp; j--; }
        }
        let leftCount = i - first;
        if (leftCount === 0 || leftCount === count) { leftCount = count >> 1; } // fallback median-ish
        const l = nodeCount++, r = nodeCount++;
        nStart[l] = first; nCount[l] = leftCount; nLeft[l] = -1;
        nStart[r] = first + leftCount; nCount[r] = count - leftCount; nLeft[r] = -1;
        nodeBounds(l, nStart[l], nCount[l]);
        nodeBounds(r, nStart[r], nCount[r]);
        nLeft[node] = l; nCount[node] = 0; // internal node
        stack.push(l); stack.push(r);
      }
      this.bvh = { idx, nMin, nMax, nLeft, nCount, nStart, nodeCount };
      return this.bvh;
    }

    // ray vs AABB slab test; returns tNear or Infinity
    _rayBox(ox, oy, oz, idx_, idy, idz, node, nMin, nMax) {
      let tmin = 0, tmax = Infinity;
      let lo = (nMin[node * 3] - ox) * idx_, hi = (nMax[node * 3] - ox) * idx_;
      if (lo > hi) { const t = lo; lo = hi; hi = t; }
      if (lo > tmin) tmin = lo; if (hi < tmax) tmax = hi;
      lo = (nMin[node * 3 + 1] - oy) * idy; hi = (nMax[node * 3 + 1] - oy) * idy;
      if (lo > hi) { const t = lo; lo = hi; hi = t; }
      if (lo > tmin) tmin = lo; if (hi < tmax) tmax = hi;
      lo = (nMin[node * 3 + 2] - oz) * idz; hi = (nMax[node * 3 + 2] - oz) * idz;
      if (lo > hi) { const t = lo; lo = hi; hi = t; }
      if (lo > tmin) tmin = lo; if (hi < tmax) tmax = hi;
      return tmax >= tmin ? tmin : Infinity;
    }

    // nearest ray hit (Möller–Trumbore), skip triangle `skip`. Returns t or Infinity.
    raycast(ox, oy, oz, dx, dy, dz, skip, twoSided, backOnly) {
      const b = this.bvh; if (!b) this.buildBVH();
      const { idx, nMin, nMax, nLeft, nCount, nStart } = this.bvh;
      const pos = this.positions;
      const idx_ = 1 / (dx || 1e-20), idy = 1 / (dy || 1e-20), idz = 1 / (dz || 1e-20);
      let best = Infinity, bestFace = -1;
      const stack = this._tstack || (this._tstack = new Int32Array(128));
      let sp = 0; stack[sp++] = 0;
      const EPS = 1e-7;
      while (sp > 0) {
        const node = stack[--sp];
        const tb = this._rayBox(ox, oy, oz, idx_, idy, idz, node, nMin, nMax);
        if (tb >= best) continue;
        if (nLeft[node] < 0) { // leaf
          const first = nStart[node], count = nCount[node];
          for (let i = 0; i < count; i++) {
            const f = idx[first + i];
            if (f === skip) continue;
            const o = f * 9;
            const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
            const e1x = pos[o + 3] - ax, e1y = pos[o + 4] - ay, e1z = pos[o + 5] - az;
            const e2x = pos[o + 6] - ax, e2y = pos[o + 7] - ay, e2z = pos[o + 8] - az;
            const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
            const det = e1x * px + e1y * py + e1z * pz;
            // det = -(dir · geometricNormal): det<0 => ray hits the BACK face
            // (surface whose outward normal points along the ray) — this is the
            // opposite wall for thickness. backOnly rejects front-facing hits
            // that occur when the ray crosses an open cavity (the 643mm artifact).
            if (backOnly) { if (det > -EPS) continue; }
            else if (!twoSided) { if (det < EPS) continue; }
            else { if (det > -EPS && det < EPS) continue; }
            const inv = 1 / det;
            const tx = ox - ax, ty = oy - ay, tz = oz - az;
            const uu = (tx * px + ty * py + tz * pz) * inv;
            if (uu < -1e-6 || uu > 1 + 1e-6) continue;
            const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
            const vv = (dx * qx + dy * qy + dz * qz) * inv;
            if (vv < -1e-6 || uu + vv > 1 + 1e-6) continue;
            const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
            if (t > EPS && t < best) { best = t; bestFace = f; }
          }
        } else {
          stack[sp++] = nLeft[node]; stack[sp++] = nLeft[node] + 1;
        }
      }
      this._lastFace = bestFace;
      return best;
    }

    // ----- wall thickness (chunked). opts:{sample} ; cb(progress 0..1); done(result) -----
    runThickness(opts, onProgress, done) {
      opts = opts || {};
      this.buildBVH();
      const F = this.F, cen = this.faceC, nrm = this.faceN;
      const step = Math.max(1, opts.sample || 1);
      const th = new Float32Array(F); th.fill(NaN);
      let f = 0;
      let mn = Infinity, mx = -Infinity, sum = 0, cnt = 0;
      const chunk = 4000;
      const self = this;
      function work() {
        if (self._disposed) return;
        const end = Math.min(F, f + chunk * step);
        for (; f < end; f += step) {
          const nx = nrm[f * 3], ny = nrm[f * 3 + 1], nz = nrm[f * 3 + 2];
          const ox = cen[f * 3] - nx * 1e-4, oy = cen[f * 3 + 1] - ny * 1e-4, oz = cen[f * 3 + 2] - nz * 1e-4;
          // shoot inward (-normal) and accept only the nearest BACK-facing hit =
          // the opposite wall's inner surface. Rejects rays that leave the solid
          // through a concavity and gauge across an open gap.
          const t = self.raycast(ox, oy, oz, -nx, -ny, -nz, f, false, true);
          if (isFinite(t)) {
            th[f] = t;
            if (t < mn) mn = t; if (t > mx) mx = t; sum += t; cnt++;
          }
        }
        if (onProgress) onProgress(f / F);
        if (f < F) { (self._raf2 = requestAnimationFrame(work)); }
        else {
          self.thickness = th; self.thickRange = [mn, mx];
          done && done({ min: isFinite(mn) ? mn : 0, max: isFinite(mx) ? mx : 0,
            mean: cnt ? sum / cnt : 0, count: cnt, sample: step, array: th });
        }
      }
      work();
    }

    // ================= CUT PLANE =================
    // axis 0/1/2, pos in ORIGINAL coords. Returns {area, segments:[[x,y,z,x,y,z]...] in original space}
    cutPlane(axis, posOrig) {
      const pos = this.positions, F = this.F, nrm = this.faceN;
      const c = posOrig - this.center[axis]; // plane coord in centered space
      const ai = [[1, 2], [0, 2], [0, 1]][axis];
      const u = ai[0], v = ai[1];
      let areaAcc = 0;
      const segs = [];
      const P = [0, 0, 0], Q = [0, 0, 0];
      for (let f = 0; f < F; f++) {
        const o = f * 9;
        // vertex signed distances to plane
        const d0 = pos[o + axis] - c, d1 = pos[o + 3 + axis] - c, d2 = pos[o + 6 + axis] - c;
        const s0 = d0 > 0, s1 = d1 > 0, s2 = d2 > 0;
        if (s0 === s1 && s1 === s2) continue; // no crossing
        // find the two edges that cross
        const pts = [];
        const edges = [[0, 1, d0, d1], [1, 2, d1, d2], [2, 0, d2, d0]];
        for (let e = 0; e < 3; e++) {
          const a = edges[e][0], b = edges[e][1], da = edges[e][2], db = edges[e][3];
          if ((da > 0) !== (db > 0)) {
            const tt = da / (da - db);
            const oa = o + a * 3, ob = o + b * 3;
            pts.push([
              pos[oa] + (pos[ob] - pos[oa]) * tt,
              pos[oa + 1] + (pos[ob + 1] - pos[oa + 1]) * tt,
              pos[oa + 2] + (pos[ob + 2] - pos[oa + 2]) * tt
            ]);
          }
        }
        if (pts.length !== 2) continue;
        let A = pts[0], B = pts[1];
        // orient: edge dir should be cross(planeNormal, faceNormal) so interior on consistent side
        const fnx = nrm[f * 3], fny = nrm[f * 3 + 1], fnz = nrm[f * 3 + 2];
        // planeNormal = axis unit
        const pn = [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0];
        const want = cross(pn, [fnx, fny, fnz]); // desired tangent dir
        const ex = B[0] - A[0], ey = B[1] - A[1], ez = B[2] - A[2];
        if ((ex * want[0] + ey * want[1] + ez * want[2]) < 0) { const t = A; A = B; B = t; }
        // shoelace in plane coords (u,v)
        areaAcc += A[u] * B[v] - B[u] * A[v];
        // store segment in original space
        segs.push([A[0] + this.center[0], A[1] + this.center[1], A[2] + this.center[2],
                   B[0] + this.center[0], B[1] + this.center[1], B[2] + this.center[2]]);
      }
      return { area: Math.abs(areaAcc) * 0.5, segments: segs };
    }

    // ================= THREE.JS VIEWER (optional) =================
    initViewer() {
      if (typeof THREE === 'undefined' || !this.host) return false;
      const host = this.host;
      const W = host.clientWidth || 600, H = host.clientHeight || 420;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0d1117);
      const camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 1e7);
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.localClippingEnabled = true;
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(W, H);
      host.innerHTML = '';
      host.appendChild(renderer.domElement);
      renderer.domElement.style.display = 'block';

      const hemi = new THREE.HemisphereLight(0xffffff, 0x2a3848, 1.05);
      scene.add(hemi);
      const dir = new THREE.DirectionalLight(0xffffff, 0.55); dir.position.set(1, 1.5, 1); scene.add(dir);
      const dir2 = new THREE.DirectionalLight(0xbcd4ff, 0.3); dir2.position.set(-1, -0.5, -1); scene.add(dir2);
      // camera-following headlight: whatever the user looks at is always lit, so an
      // open shell / part facing away never goes pure-black (which reads as "missing")
      const head = new THREE.DirectionalLight(0xffffff, 0.6); scene.add(head);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color: 0x9fb0c0, metalness: 0.1, roughness: 0.72, flatShading: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);

      // wire/edge box
      const sz = this.bboxOrig;
      const size = [sz.max[0] - sz.min[0], sz.max[1] - sz.min[1], sz.max[2] - sz.min[2]];
      const boxGeo = new THREE.BoxGeometry(size[0], size[1], size[2]);
      const boxEdges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo), new THREE.LineBasicMaterial({ color: 0x2d3742 }));
      scene.add(boxEdges);

      const grpOverlay = new THREE.Group(); scene.add(grpOverlay); // cut outline / measure
      const grpEdges = new THREE.Group(); scene.add(grpEdges); // open-edge (bad-edge) highlight

      const radius = Math.max(size[0], size[1], size[2], 1) * 1.6;
      this.three = { scene, camera, renderer, mesh, mat, geo, grpOverlay, grpEdges, boxEdges, radius, W, H, head,
        yaw: 0.7, pitch: 0.5, dist: radius, target: new THREE.Vector3(0, 0, 0), baseColor: 0x9fb0c0 };
      this._applyCamera();
      this._bindControls();
      const self = this;
      function loop() { if (self._disposed) return; self.three.renderer.render(self.three.scene, self.three.camera); self._raf = requestAnimationFrame(loop); }
      loop();
      return true;
    }

    _applyCamera() {
      const t = this.three; if (!t) return;
      const x = t.dist * Math.cos(t.pitch) * Math.sin(t.yaw);
      const y = t.dist * Math.sin(t.pitch);
      const z = t.dist * Math.cos(t.pitch) * Math.cos(t.yaw);
      t.camera.position.set(t.target.x + x, t.target.y + y, t.target.z + z);
      t.camera.up.set(0, 1, 0);
      t.camera.lookAt(t.target);
      if (t.head) t.head.position.copy(t.camera.position);
    }

    resize() {
      const t = this.three; if (!t) return;
      const W = this.host.clientWidth || t.W, H = this.host.clientHeight || t.H;
      t.W = W; t.H = H; t.camera.aspect = W / H; t.camera.updateProjectionMatrix(); t.renderer.setSize(W, H);
    }

    _bindControls() {
      const t = this.three, dom = t.renderer.domElement, self = this;
      let drag = null, lx = 0, ly = 0;
      dom.addEventListener('mousedown', (e) => {
        if (self.measureOn) { self._pick(e); return; }
        drag = e.button === 2 || e.shiftKey ? 'pan' : 'rot'; lx = e.clientX; ly = e.clientY; e.preventDefault();
      });
      window.addEventListener('mousemove', (e) => {
        if (!drag) return;
        const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
        if (drag === 'rot') {
          t.yaw -= dx * 0.01; t.pitch += dy * 0.01;
          t.pitch = Math.max(-1.54, Math.min(1.54, t.pitch));
        } else {
          const panScale = t.dist * 0.0016;
          const right = new THREE.Vector3(); t.camera.getWorldDirection(right);
          const r = new THREE.Vector3().crossVectors(right, t.camera.up).normalize();
          const upv = new THREE.Vector3().crossVectors(r, right).normalize();
          t.target.addScaledVector(r, -dx * panScale);
          t.target.addScaledVector(upv, dy * panScale);
        }
        self._applyCamera();
      });
      window.addEventListener('mouseup', () => { drag = null; });
      dom.addEventListener('wheel', (e) => { e.preventDefault(); t.dist *= (1 + (e.deltaY > 0 ? 0.12 : -0.12)); t.dist = Math.max(t.radius * 0.05, Math.min(t.radius * 40, t.dist)); self._applyCamera(); }, { passive: false });
      dom.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // ----- color modes -----
    setColorPlain() {
      const t = this.three; if (!t) return;
      if (t.geo.getAttribute('color')) { t.geo.deleteAttribute('color'); }
      t.mat.vertexColors = false; t.mat.color.setHex(t.baseColor); t.mat.needsUpdate = true;
    }

    _setVertexColors(colorForFace) {
      const t = this.three; if (!t) return;
      const F = this.F;
      const col = new Float32Array(F * 9);
      for (let f = 0; f < F; f++) {
        const c = colorForFace(f);
        for (let k = 0; k < 3; k++) { col[f * 9 + k * 3] = c[0]; col[f * 9 + k * 3 + 1] = c[1]; col[f * 9 + k * 3 + 2] = c[2]; }
      }
      t.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      t.mat.vertexColors = true; t.mat.color.setHex(0xffffff); t.mat.needsUpdate = true;
    }

    colorThickness(minV, maxV) {
      const th = this.thickness; if (!th) return;
      const lo = minV != null ? minV : this.thickRange[0], hi = maxV != null ? maxV : this.thickRange[1];
      const span = (hi - lo) || 1;
      const self = this;
      this._setVertexColors(function (f) {
        const v = th[f];
        if (isNaN(v)) return [0.35, 0.4, 0.46];
        const x = Math.max(0, Math.min(1, (v - lo) / span)); // 0 thin .. 1 thick
        return rampThin(x); // thin=red -> thick=blue
      });
    }

    colorDraft(cls) {
      this._setVertexColors(function (f) {
        const c = cls[f];
        if (c === 2) return [0.91, 0.30, 0.32];   // low draft red
        if (c === 3) return [0.85, 0.30, 0.78];   // undercut magenta
        if (c === 0) return [0.30, 0.55, 0.78];   // cover side blue
        return [0.45, 0.5, 0.56];                  // ejector side grey
      });
    }

    // overlay: cut-plane outline (segments in original space) + plane quad
    showCutOutline(segments, axis, posOrig) {
      const t = this.three; if (!t) return;
      this.clearOverlay();
      if (segments && segments.length) {
        const arr = new Float32Array(segments.length * 6);
        for (let i = 0; i < segments.length; i++) {
          const s = segments[i];
          for (let k = 0; k < 6; k++) arr[i * 6 + k] = s[k] - this.center[(k % 3)];
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x38d6c4 }));
        t.grpOverlay.add(lines);
      }
    }

    clearOverlay() {
      const t = this.three; if (!t) return;
      while (t.grpOverlay.children.length) { const c = t.grpOverlay.children.pop(); if (c.geometry) c.geometry.dispose(); }
    }

    // ----- render mode: shaded / wireframe / xray (transparent) -----
    setRenderMode(mode) {
      const t = this.three; if (!t) return;
      this.renderMode = mode;
      const m = t.mat;
      if (mode === 'wireframe') { m.wireframe = true; m.transparent = false; m.opacity = 1; m.depthWrite = true; }
      else if (mode === 'xray') { m.wireframe = false; m.transparent = true; m.opacity = 0.3; m.depthWrite = false; }
      else { m.wireframe = false; m.transparent = false; m.opacity = 1; m.depthWrite = true; }
      m.needsUpdate = true;
    }

    // ----- open-edge ("bad edge") detection: weld vertices, find boundary edges -----
    // A manifold closed mesh shares every edge between exactly 2 triangles. Edges used
    // by only one triangle are open boundaries => holes / missing faces (Magics-style).
    analyzeEdges() {
      const pos = this.positions, F = this.F, bb = this.bboxOrig;
      const span = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) || 1;
      const eps = span * 1e-5 + 1e-7;
      const vkey = (x, y, z) => Math.round(x / eps) + '_' + Math.round(y / eps) + '_' + Math.round(z / eps);
      const edge = new Map();
      for (let f = 0; f < F; f++) {
        const o = f * 9;
        const vs = [[pos[o], pos[o + 1], pos[o + 2]], [pos[o + 3], pos[o + 4], pos[o + 5]], [pos[o + 6], pos[o + 7], pos[o + 8]]];
        const ks = [vkey(vs[0][0], vs[0][1], vs[0][2]), vkey(vs[1][0], vs[1][1], vs[1][2]), vkey(vs[2][0], vs[2][1], vs[2][2])];
        for (let e = 0; e < 3; e++) {
          const a = e, b = (e + 1) % 3;
          const ek = ks[a] < ks[b] ? ks[a] + '|' + ks[b] : ks[b] + '|' + ks[a];
          let rec = edge.get(ek);
          if (!rec) {
            rec = { count: 0, seg: [
              vs[a][0] + this.center[0], vs[a][1] + this.center[1], vs[a][2] + this.center[2],
              vs[b][0] + this.center[0], vs[b][1] + this.center[1], vs[b][2] + this.center[2]] };
            edge.set(ek, rec);
          }
          rec.count++;
        }
      }
      const segs = []; let open = 0, badNonManifold = 0;
      edge.forEach(r => { if (r.count === 1) { open++; segs.push(r.seg); } else if (r.count > 2) { badNonManifold++; } });
      this._openEdges = segs;
      return { openCount: open, nonManifold: badNonManifold, edgeTotal: edge.size, segments: segs };
    }

    showOpenEdges(segments) {
      const t = this.three; if (!t) return;
      this._clearEdges();
      if (!segments || !segments.length) return;
      const arr = new Float32Array(segments.length * 6);
      for (let i = 0; i < segments.length; i++) { const s = segments[i]; for (let k = 0; k < 6; k++) arr[i * 6 + k] = s[k] - this.center[k % 3]; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xff4d4d }));
      lines.renderOrder = 5;
      t.grpEdges.add(lines);
    }
    hideOpenEdges() { this._clearEdges(); }
    _clearEdges() { const t = this.three; if (!t || !t.grpEdges) return; while (t.grpEdges.children.length) { const c = t.grpEdges.children.pop(); if (c.geometry) c.geometry.dispose(); } }

    // ----- multiple cross-section planes drawn at once -----
    // list: [{axis, pos}]. Returns areas[] (mm²) in the same order.
    showSections(list) {
      const t = this.three;
      const areas = [];
      if (t) this.clearOverlay();
      (list || []).forEach(s => {
        const r = this.cutPlane(s.axis, s.pos);
        areas.push(r.area);
        if (t && r.segments.length) {
          const arr = new Float32Array(r.segments.length * 6);
          for (let i = 0; i < r.segments.length; i++) { const sg = r.segments[i]; for (let k = 0; k < 6; k++) arr[i * 6 + k] = sg[k] - this.center[k % 3]; }
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
          const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x38d6c4 }));
          lines.renderOrder = 4;
          t.grpOverlay.add(lines);
        }
      });
      return areas;
    }

    // ----- clipping: hide the part on one side of section planes (Magics "cut") -----
    // list:[{axis,pos,sign}] — sign +1 keeps the high side, -1 keeps the low side.
    setClip(list) {
      const t = this.three; if (!t) return;
      const planes = (list || []).map(s => {
        const c = s.pos - this.center[s.axis];           // plane coord in centered space
        const n = new THREE.Vector3(s.axis === 0 ? s.sign : 0, s.axis === 1 ? s.sign : 0, s.axis === 2 ? s.sign : 0);
        return new THREE.Plane(n, -c * s.sign);
      });
      t.mat.clippingPlanes = planes.length ? planes : null;
      t.mat.clipIntersection = false;                     // keep intersection of half-spaces
      t.mat.needsUpdate = true;
    }

    setBoxVisible(on) { const t = this.three; if (t && t.boxEdges) t.boxEdges.visible = !!on; }

    // ----- measurement (Magics-style multi-mode) -----
    // modes: point | distance | angle | radius | thickness
    _measureNeed(mode) {
      return mode === 'distance' ? 2 : (mode === 'angle' || mode === 'radius') ? 3 : 1;
    }
    setMeasure(on, mode) {
      this.measureOn = on;
      if (mode) this.measureMode = mode;
      if (!this.measureMode) this.measureMode = 'distance';
      this.measurePts = []; this.measureNrm = []; this._thickSeg = null;
      this.clearOverlay();
    }
    setMeasureMode(mode) {
      this.measureMode = mode;
      this.measurePts = []; this.measureNrm = []; this._thickSeg = null;
      this.clearOverlay();
      if (this.opts.onMeasure) this.opts.onMeasure(null);
    }

    _world(p) { return [p.x + this.center[0], p.y + this.center[1], p.z + this.center[2]]; }

    // circumcircle of 3 points in 3D -> {center, r, normal} or null if collinear
    _circle3(P1, P2, P3) {
      const a = new THREE.Vector3().subVectors(P2, P1);
      const b = new THREE.Vector3().subVectors(P3, P1);
      const axb = new THREE.Vector3().crossVectors(a, b);
      const n2 = axb.dot(axb);
      if (n2 < 1e-10) return null;
      const aa = a.dot(a), bb = b.dot(b);
      const t1 = b.clone().multiplyScalar(aa).sub(a.clone().multiplyScalar(bb)); // |a|²b − |b|²a
      const toC = new THREE.Vector3().crossVectors(t1, axb).divideScalar(2 * n2);
      return { center: P1.clone().add(toC), r: toC.length(), normal: axb.normalize() };
    }

    _pick(e) {
      const t = this.three; if (!t) return;
      const rect = t.renderer.domElement.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const rc = new THREE.Raycaster();
      rc.setFromCamera({ x: mx, y: my }, t.camera);
      const hit = rc.intersectObject(t.mesh, false)[0];
      if (!hit) return;
      const mode = this.measureMode || 'distance';
      const need = this._measureNeed(mode);
      this.measurePts = this.measurePts || [];
      this.measureNrm = this.measureNrm || [];
      if (this.measurePts.length >= need) { this.measurePts = []; this.measureNrm = []; this._thickSeg = null; }
      this.measurePts.push(hit.point.clone());
      this.measureNrm.push(hit.face ? hit.face.normal.clone().normalize() : null);
      this._drawMeasure();
      if (this.measurePts.length === need) {
        const res = this._computeMeasure(mode);
        if (res && !res.invalid) this._drawMeasure(); // redraw with computed geometry (thickness seg / circle)
        if (this.opts.onMeasure) this.opts.onMeasure(res);
      } else if (this.opts.onMeasure) {
        this.opts.onMeasure({ mode, partial: true, count: this.measurePts.length, need });
      }
    }

    _computeMeasure(mode) {
      const P = this.measurePts;
      if (mode === 'point') return { mode, p: this._world(P[0]) };
      if (mode === 'distance') {
        const a = P[0], b = P[1];
        return { mode, d: a.distanceTo(b), dx: Math.abs(b.x - a.x), dy: Math.abs(b.y - a.y), dz: Math.abs(b.z - a.z), p1: this._world(a), p2: this._world(b) };
      }
      if (mode === 'angle') {
        const a = P[0], v = P[1], c = P[2];
        const u1 = new THREE.Vector3().subVectors(a, v), u2 = new THREE.Vector3().subVectors(c, v);
        let cos = u1.dot(u2) / ((u1.length() * u2.length()) || 1);
        cos = Math.max(-1, Math.min(1, cos));
        return { mode, deg: Math.acos(cos) * 180 / Math.PI, vertex: this._world(v) };
      }
      if (mode === 'radius') {
        const c = this._circle3(P[0], P[1], P[2]);
        if (!c) return { mode, invalid: true };
        this._measCircle = c;
        return { mode, r: c.r, dia: c.r * 2, center: this._world(c.center) };
      }
      if (mode === 'thickness') {
        const p = P[0], n = this.measureNrm[0];
        if (!n) return { mode, invalid: true };
        const ox = p.x - n.x * 1e-4, oy = p.y - n.y * 1e-4, oz = p.z - n.z * 1e-4;
        const th = this.raycast(ox, oy, oz, -n.x, -n.y, -n.z, -1, false, true);
        if (!isFinite(th)) return { mode, invalid: true };
        this._thickSeg = [p.clone(), new THREE.Vector3(p.x - n.x * th, p.y - n.y * th, p.z - n.z * th)];
        return { mode, t: th, p: this._world(p) };
      }
      return { mode, invalid: true };
    }

    _drawMeasure() {
      const t = this.three; this.clearOverlay();
      const C = 0x38d6c4;
      const sph = (p, r, col) => { const s = new THREE.Mesh(new THREE.SphereGeometry((r || 0.012) * t.radius, 12, 12), new THREE.MeshBasicMaterial({ color: col == null ? C : col, depthTest: false })); s.position.copy(p); s.renderOrder = 999; t.grpOverlay.add(s); };
      const line = (a, b, col) => { const g = new THREE.BufferGeometry().setFromPoints([a, b]); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: col == null ? C : col, depthTest: false })); l.renderOrder = 998; t.grpOverlay.add(l); };
      const pts = this.measurePts || [];
      pts.forEach(p => sph(p));
      const mode = this.measureMode || 'distance';
      if (mode === 'distance' && pts.length === 2) line(pts[0], pts[1]);
      if (mode === 'angle' && pts.length >= 2) { line(pts[1], pts[0]); if (pts.length === 3) line(pts[1], pts[2]); }
      if (mode === 'radius' && pts.length === 3) {
        const c = this._circle3(pts[0], pts[1], pts[2]);
        if (c) {
          const n = c.normal.clone().normalize();
          let e1 = new THREE.Vector3(1, 0, 0);
          if (Math.abs(n.dot(e1)) > 0.9) e1.set(0, 1, 0);
          e1.crossVectors(n, e1).normalize();
          const e2 = new THREE.Vector3().crossVectors(n, e1).normalize();
          const cp = [];
          for (let i = 0; i <= 72; i++) { const a = i / 72 * Math.PI * 2; cp.push(new THREE.Vector3().copy(c.center).addScaledVector(e1, Math.cos(a) * c.r).addScaledVector(e2, Math.sin(a) * c.r)); }
          const g = new THREE.BufferGeometry().setFromPoints(cp);
          const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: C, depthTest: false })); l.renderOrder = 998; t.grpOverlay.add(l);
          sph(c.center, 0.008, C);
        }
      }
      if (mode === 'thickness' && this._thickSeg) line(this._thickSeg[0], this._thickSeg[1], 0xffb454);
    }

    screenshot() { try { return this.three ? this.three.renderer.domElement.toDataURL('image/png') : null; } catch (e) { return null; } }

    disposeViewer() {
      if (this._raf) cancelAnimationFrame(this._raf); this._raf = null;
      try {
        if (this.three) { this.three.renderer.dispose(); if (this.three.renderer.domElement.parentNode) this.three.renderer.domElement.parentNode.removeChild(this.three.renderer.domElement); }
      } catch (e) {}
      this.three = null;
    }

    dispose() {
      this._disposed = true;
      if (this._raf) cancelAnimationFrame(this._raf);
      if (this._raf2) cancelAnimationFrame(this._raf2);
      if (this._raf3) cancelAnimationFrame(this._raf3);
      try {
        if (this.three) { this.three.renderer.dispose(); if (this.three.renderer.domElement.parentNode) this.three.renderer.domElement.parentNode.removeChild(this.three.renderer.domElement); }
      } catch (e) {}
      this.three = null;
    }
  }

  // thin(red) -> mid(yellow/green) -> thick(blue) ramp, returns [r,g,b] 0..1
  function rampThin(x) {
    // x: 0 = thin (red), 1 = thick (blue)
    const stops = [
      [0.00, [0.86, 0.20, 0.22]],
      [0.30, [0.95, 0.62, 0.20]],
      [0.55, [0.92, 0.86, 0.25]],
      [0.78, [0.30, 0.74, 0.45]],
      [1.00, [0.22, 0.52, 0.86]]
    ];
    for (let i = 0; i < stops.length - 1; i++) {
      if (x <= stops[i + 1][0]) {
        const a = stops[i], b = stops[i + 1];
        const tt = (x - a[0]) / (b[0] - a[0] || 1);
        return [a[1][0] + (b[1][0] - a[1][0]) * tt, a[1][1] + (b[1][1] - a[1][1]) * tt, a[1][2] + (b[1][2] - a[1][2]) * tt];
      }
    }
    return stops[stops.length - 1][1];
  }

  CadEngine.rampThin = rampThin;
  window.CadEngine = CadEngine;
})();
