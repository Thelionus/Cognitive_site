const fs = require('fs');

// NYC equivalent of fetch-population.js — 2020 Census of Population figures
// (US Census Bureau) for the five boroughs, which are New York City's
// official county-equivalent units, so unlike Montréal's boroughs these are
// standalone Census-published geographies. Same rationale as the Montréal
// file: this is static reference data (next census: 2030), so it's a
// one-time verified dataset rather than something polled from a live API.
//
// population / areaKm2 are 2020 Census figures as published; density is
// computed from them here rather than re-typed, to avoid a transcription
// mismatch between the two. lat/lon are approximate borough-centre points
// for map placement, not official centroids.
const AREAS = [
  { id: 'manhattan', name: 'Manhattan (New York County)', population: 1694250, areaKm2: 58.69, lat: 40.7831, lon: -73.9712 },
  { id: 'brooklyn', name: 'Brooklyn (Kings County)', population: 2736074, areaKm2: 183.4, lat: 40.6782, lon: -73.9442 },
  { id: 'queens', name: 'Queens (Queens County)', population: 2405464, areaKm2: 280.0, lat: 40.7282, lon: -73.7949 },
  { id: 'bronx', name: 'The Bronx (Bronx County)', population: 1472654, areaKm2: 109.0, lat: 40.8448, lon: -73.8648 },
  { id: 'staten-island', name: 'Staten Island (Richmond County)', population: 495747, areaKm2: 151.5, lat: 40.5795, lon: -74.1502 }
];

function main() {
  const areas = AREAS.map(a => ({ ...a, density: Math.round((a.population / a.areaKm2) * 10) / 10 }));
  fs.writeFileSync('population-nyc.json', JSON.stringify({
    timestamp: Date.now(),
    source: 'US Census Bureau, 2020 Census of Population (public data, static reference — see fetch-population-nyc.js for citation notes)',
    areas
  }));
  console.log(`Saved ${areas.length} population-density reference areas`);
}

main();
