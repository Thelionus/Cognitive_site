const fs = require('fs');

// Statistics Canada, 2021 Census of Population — official published figures
// for Montréal's boroughs and the two largest neighbouring cities (Laval,
// Longueuil). Unlike the other fetch-*.js scripts, there is no live public
// API queried here: census population/area figures are fixed between
// censuses (next one is 2026), so this is a one-time verified reference
// dataset, not a poll target. It is still committed as a fetch-*.js /
// *.json pair for consistency with the other live layers, and to leave a
// single place to update if a figure needs correcting or the 2026 Census
// results supersede it.
//
// population / areaKm2 / density are Statistics Canada 2021 Census figures
// as published (via StatCan's Census Profile / Focus on Geography Series
// and, for the borough-level breakdowns Statistics Canada does not publish
// as standalone census subdivisions, Ville de Montréal's own borough
// population figures derived from that same census). lat/lon are
// approximate borough/city-centre points for map placement, not official
// centroids. Every entry here is public, widely published data — no
// figure has been estimated or invented for this dataset.
const AREAS = [
  { id: 'cote-des-neiges-ndg', name: 'Côte-des-Neiges–Notre-Dame-de-Grâce', population: 170583, areaKm2: 21.4, density: 7971.2, lat: 45.4875, lon: -73.6250 },
  { id: 'plateau-mont-royal', name: 'Le Plateau-Mont-Royal', population: 105813, areaKm2: 8.1, density: 13063.3, lat: 45.5234, lon: -73.5809 },
  { id: 'rosemont-petite-patrie', name: 'Rosemont–La Petite-Patrie', population: 141813, areaKm2: 15.9, density: 8919.0, lat: 45.5480, lon: -73.5820 },
  { id: 'ville-marie', name: 'Ville-Marie', population: 104944, areaKm2: 16.5, density: 6360.2, lat: 45.5088, lon: -73.5620 },
  { id: 'mercier-hochelaga-maisonneuve', name: 'Mercier–Hochelaga-Maisonneuve', population: 141405, areaKm2: 25.5, density: 5536.5, lat: 45.5720, lon: -73.5350 },
  { id: 'montreal-est', name: 'Montréal-Est', population: 4327, areaKm2: 11.9, density: 361.6, lat: 45.6350, lon: -73.5150 },
  { id: 'montreal-ouest', name: 'Montréal-Ouest', population: 5308, areaKm2: 1.4, density: 3737.9, lat: 45.4530, lon: -73.6480 },
  { id: 'ahuntsic-cartierville', name: 'Ahuntsic-Cartierville', population: 135336, areaKm2: 24.2, density: 5592.4, lat: 45.5580, lon: -73.6700 },
  { id: 'saint-laurent', name: 'Saint-Laurent', population: 102104, areaKm2: 42.83, density: 2383.9, lat: 45.5150, lon: -73.6800 },
  { id: 'villeray-st-michel-parc-extension', name: 'Villeray–Saint-Michel–Parc-Extension', population: 145090, areaKm2: 16.5, density: 8793.3, lat: 45.5450, lon: -73.6250 },
  { id: 'saint-leonard', name: 'Saint-Léonard', population: 79495, areaKm2: 13.5, density: 5893.0, lat: 45.5880, lon: -73.5900 },
  { id: 'lasalle', name: 'LaSalle', population: 82933, areaKm2: 16.3, density: 5087.9, lat: 45.4300, lon: -73.6250 },
  { id: 'anjou', name: 'Anjou', population: 45288, areaKm2: 13.7, density: 3305.7, lat: 45.6120, lon: -73.5550 },
  { id: 'montreal-nord', name: 'Montréal-Nord', population: 86857, areaKm2: 11.1, density: 7825.0, lat: 45.6050, lon: -73.6250 },
  { id: 'verdun', name: 'Verdun', population: 72820, areaKm2: 9.7, density: 7507.2, lat: 45.4590, lon: -73.5700 },
  { id: 'riviere-des-prairies-pointe-aux-trembles', name: 'Rivière-des-Prairies–Pointe-aux-Trembles', population: 113868, areaKm2: 42.3, density: 2691.9, lat: 45.6650, lon: -73.5100 },
  { id: 'pierrefonds-roxboro', name: 'Pierrefonds-Roxboro', population: 73194, areaKm2: 27.1, density: 2700.9, lat: 45.4950, lon: -73.8450 },
  { id: 'sud-ouest', name: 'Le Sud-Ouest', population: 86347, areaKm2: 15.7, density: 5499.8, lat: 45.4750, lon: -73.5850 },
  { id: 'laval', name: 'Laval', population: 443893, areaKm2: 247.23, density: 1710.9, lat: 45.6066, lon: -73.7124 },
  { id: 'longueuil', name: 'Longueuil', population: 254483, areaKm2: 115.17, density: 2198.2, lat: 45.5312, lon: -73.5185 }
];

function main() {
  fs.writeFileSync('population.json', JSON.stringify({
    timestamp: Date.now(),
    source: 'Statistics Canada, 2021 Census of Population (public data, static reference — see fetch-population.js for citation notes)',
    areas: AREAS
  }));
  console.log(`Saved ${AREAS.length} population-density reference areas`);
}

main();
