// app.js — wires up DEM loading, map UI, worker dispatch, result overlay

// ============================================================================
// i18n
// ============================================================================
// Tiny translation layer: a single STRINGS dict, plus three hooks:
//   t(key, ...args)     — look up the current-language string, optional
//                          {0}/{1} placeholder substitution.
//   applyTranslations() — walks the DOM and substitutes textContent /
//                          innerHTML / title for every [data-i18n*] element.
//   setLang(lang)       — flips the active language (persists in localStorage)
//                          and re-applies.
//
// HTML elements opt in via:
//   data-i18n="key"       → textContent
//   data-i18n-html="key"  → innerHTML  (use for strings with markup)
//   data-i18n-title="key" → title attribute
//   data-i18n-aria="key"  → aria-label (controls with no visible label)
//
// JS-set strings (status messages, computed labels) call t("key") directly.

const STRINGS = {
  // ---- Header / chrome --------------------------------------------------
  "title":               { pt: "Simujaules",       en: "Simujaules" },
  "subtitle":            { pt: "Imaginador de caminhos fáceis para o encontro", en: "Imagining easy paths to the gathering" },
  "lang.toggle.title":   { pt: "Idioma — clique para alternar PT/EN", en: "Language — click to switch PT/EN" },
  // (engine.* strings removed along with the engine-tag pill.)
  "locate.title":        { pt: "Centralizar na minha localização",     en: "Center on my location" },
  "map.zoom_in":         { pt: "Aproximar",                             en: "Zoom in" },
  "map.zoom_out":        { pt: "Afastar",                               en: "Zoom out" },
  "locate.requesting":   { pt: "Buscando localização…",                 en: "Locating…" },
  "locate.centered":     { pt: "Centralizado em {0}, {1}.",             en: "Centred at {0}, {1}." },
  "locate.denied":       { pt: "Acesso à localização negado.",          en: "Location access denied." },
  // Busca de endereços (🔍 geocoding via Photon; ver o bloco geo-search).
  "geosearch.title":       { pt: "Buscar endereço ou lugar",  en: "Search address or place" },
  "geosearch.placeholder": { pt: "Buscar endereço ou lugar…", en: "Search an address or place…" },
  "geosearch.results":     { pt: "Resultados da busca",       en: "Search results" },
  "geosearch.searching":   { pt: "Buscando…",                 en: "Searching…" },
  "geosearch.none":        { pt: "Nenhum resultado — tente incluir bairro ou cidade", en: "No results — try adding a neighbourhood or city" },
  "geosearch.net_error":   { pt: "Erro de rede na busca",     en: "Search network error" },
  "geosearch.attrib":      { pt: "busca <a href=\"https://photon.komoot.io/\" target=\"_blank\" rel=\"noopener\">Photon</a> · dados © colaboradores do <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noopener\">OpenStreetMap</a>", en: "search <a href=\"https://photon.komoot.io/\" target=\"_blank\" rel=\"noopener\">Photon</a> · data © <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noopener\">OpenStreetMap</a> contributors" },
  // ---- Status / feedback line (#status) ---------------------------------
  // High-frequency lifecycle + validation messages and the FABDEM loader
  // (which was written in PT, so EN users saw stray Portuguese). {0}-style
  // placeholders are filled by t(); user-derived text is escaped by callers.
  "status.loading_dem":      { pt: "Carregando DEM…",                                  en: "Loading DEM…" },
  "status.computing":        { pt: "Calculando…",                                      en: "Computing…" },
  "status.done_ms":          { pt: "Concluído em {0} ms.",                             en: "Done in {0} ms." },
  "status.network_loaded":   { pt: "Rede carregada.",                                  en: "Network loaded." },
  "status.load_dem_first":   { pt: "Carregue um DEM primeiro.",                        en: "Load a DEM first." },
  "status.src_set":          { pt: "Origem definida. Clique de novo para o destino, ou rode.", en: "Source set. Click again to set destination, or run." },
  "status.both_set":         { pt: "Os dois pontos definidos. Rode para calcular.",    en: "Both points set. Run to compute." },
  "status.src_replaced":     { pt: "Origem substituída. Clique para o destino, ou rode.", en: "Source replaced. Click to set destination, or run." },
  "status.density_needs_ref":{ pt: "O modo densidade precisa de ao menos um ponto de referência — clique no mapa ou use \"Distribuir aleatórias\".", en: "Density mode needs at least one reference point — click on the map or use \"Place random\"." },
  "status.topn_needs_dst":   { pt: "Top-N de rotas exige um ponto de destino.",        en: "Top-N routes requires a destination point." },
  "status.fabdem_too_large": { pt: "Janela ~{0} MB ({1}×{2} células), acima do limite de {3} MB. Aproxime o zoom.", en: "Viewport ~{0} MB ({1}×{2} cells), over the {3} MB limit. Zoom in." },
  "status.fabdem_none":      { pt: "Nenhum tile FABDEM encontrado para esta janela (provavelmente oceano ou fora da cobertura ±60° lat).", en: "No FABDEM tiles found for this viewport (likely ocean or outside ±60° lat coverage)." },
  "status.fabdem_fetching":  { pt: "Buscando {0} tile(s) FABDEM…",                     en: "Fetching {0} FABDEM tile(s)…" },
  "status.fabdem_mosaic":    { pt: "Mosaico: tile {0}/{1}…",                           en: "Mosaicking: tile {0}/{1}…" },
  "status.fabdem_all_failed":{ pt: "FABDEM: todos os tiles falharam na leitura (rede?). Tente novamente.", en: "FABDEM: all tile reads failed (network?). Try again." },
  "status.fabdem_partial":   { pt: "Atenção: {0} de {1} tiles FABDEM falharam na leitura — o DEM tem lacunas (nodata). Recarregue para tentar de novo.", en: "Warning: {0} of {1} FABDEM tiles failed to read — the DEM has gaps (nodata). Reload to retry." },
  "status.fabdem_failed":    { pt: "Falha ao carregar FABDEM: {0}",                  en: "FABDEM load failed: {0}" },
  // DEM loading
  "status.fetching":         { pt: "Buscando {0}…",                                  en: "Fetching {0}…" },
  "status.loading_label":    { pt: "Carregando {0}…",                                en: "Loading {0}…" },
  "status.error_generic":    { pt: "Erro: {0}",                                      en: "Error: {0}" },
  "status.dem_lonlat":       { pt: "DEM em lon/lat — distâncias aproximadas pela latitude (boas a ~0,3% em extensões < ~50 km).", en: "DEM is in lon/lat — distances approximated from latitude (good to ~0.3% under ~50 km extent)." },
  "status.dem_no_geotransform":{ pt: "O GeoTIFF não tem metadados de georreferenciamento (ModelPixelScale/tie points). Use um GeoTIFF georreferenciado.", en: "The GeoTIFF lacks geotransform metadata (ModelPixelScale/tie points). Use a properly georeferenced GeoTIFF." },
  "status.mask_no_geotransform":{ pt: "O GeoTIFF de máscara não tem metadados de georreferenciamento (ModelPixelScale/tie points).", en: "Mask GeoTIFF lacks geotransform metadata (ModelPixelScale / tie points)." },
  "status.dem_loaded":       { pt: "{0} carregado. Clique no mapa para definir o ponto de origem.", en: "{0} loaded. Click on the map to set source point." },
  "status.dem_projected":    { pt: "{0} carregado, mas o CRS é projetado/desconhecido — o mapa é só lon/lat (EPSG:4326), então cliques e camadas não estão disponíveis. Reprojete o DEM para EPSG:4326 para interagir no mapa.", en: "{0} loaded, but its CRS is projected/unknown — the map is lon/lat (EPSG:4326) only, so click-to-pick and overlays are unavailable. Reproject the DEM to EPSG:4326 to interact on the map." },
  "status.map_not_ready":    { pt: "Mapa não está pronto.",                          en: "Map not ready." },
  "status.map_bounds_failed":{ pt: "Não foi possível ler os limites do mapa.",       en: "Couldn't read map bounds." },
  "status.compute_failed":   { pt: "Falha inesperada no cálculo — {0}. Tente de novo (um DEM ou orçamento menor se foi memória).", en: "Compute failed unexpectedly — {0}. Try again (a smaller DEM or budget if it was memory)." },
  // Network (.gpkg / OSM)
  "status.gpkg_failed":      { pt: "Falha ao carregar .gpkg: {0}",                   en: ".gpkg load failed: {0}" },
  "status.net_zero_cells":   { pt: "Rede rasterizada para 0 células neste DEM — não aplicada. Verifique o CRS do .gpkg e se contém geometria LineString sobrepondo a extensão do DEM.", en: "Network rasterised to 0 cells on this DEM — not applied. Check the .gpkg CRS and that it contains LineString geometry overlapping the DEM extent." },
  "status.net_zero_cells_src":{ pt: "{0}: rasterizado para 0 células neste DEM — não aplicado.", en: "{0}: rasterised to 0 cells on this DEM — not applied." },
  "status.net_too_large":    { pt: "Rede grande demais para renderização vetorial (máscara raster ainda ativa).", en: "Network too large for vector rendering (raster mask still active)." },
  "status.osm_no_intersect": { pt: "A vista atual do mapa não intersecta o DEM — vá até o DEM primeiro.", en: "The current map view doesn't intersect the DEM — pan to the DEM first." },
  "status.osm_net_geographic":{ pt: "A busca OSM precisa de um DEM geográfico (EPSG:4326) — o DEM atual está projetado.", en: "The OSM pull needs a geographic DEM (EPSG:4326) — the current DEM is projected." },
  "status.osm_querying":     { pt: "Consultando OSM (Overpass) por highway=* …",     en: "Querying OSM (Overpass) for highway=* …" },
  "status.osm_parsing":      { pt: "Lendo resposta do OSM…",                         en: "Parsing OSM response…" },
  "status.osm_rasterising":  { pt: "Rasterizando {0} vias do OSM…",                  en: "Rasterising {0} OSM ways…" },
  "status.osm_failed":       { pt: "Falha ao puxar a rede do OSM: {0}",              en: "OSM network pull failed: {0}" },
  "status.osm_no_ways":      { pt: "O Overpass não retornou vias highway=* nesta extensão.", en: "Overpass returned no highway=* ways in this extent." },
  "status.water_geographic": { pt: "Puxar água do OSM precisa de um DEM geográfico (lon/lat).", en: "OSM water pull needs a geographic (lon/lat) DEM." },
  "status.water_querying":   { pt: "Consultando OSM (Overpass) por água…",          en: "Querying OSM (Overpass) for water…" },
  "status.water_parsing":    { pt: "Lendo água do OSM…",                            en: "Parsing OSM water…" },
  "status.water_rasterising":{ pt: "Rasterizando {0} feições de água…",             en: "Rasterising {0} water features…" },
  "status.water_none":       { pt: "Nenhuma água encontrada na extensão do DEM.",   en: "No water found in the DEM extent." },
  "status.water_done":       { pt: "Água do OSM: {0} células barradas.",            en: "OSM water: {0} impassable cells." },
  "status.water_failed":     { pt: "Falha ao puxar água do OSM: {0}",               en: "OSM water pull failed: {0}" },
  "status.overpass_http":    { pt: "Overpass HTTP {0} (ocupado? tente de novo em um minuto)", en: "Overpass HTTP {0} (busy? try again in a minute)" },
  "status.vec_reading":      { pt: "Lendo {0} ({1} MB)…",                            en: "Reading {0} ({1} MB)…" },
  "status.vec_init_sql":     { pt: "Inicializando sql.js…",                          en: "Initializing sql.js…" },
  "status.sqljs_unavailable":{ pt: "sql.js não carregou (CDN bloqueado, ou offline antes do primeiro uso?)", en: "sql.js didn't load (CDN blocked, or offline before it was ever fetched?)" },
  "status.vec_rasterising_of":   { pt: "Rasterizando… <span class=\"v\">{0}</span>/{1} ({2} desenhadas)", en: "Rasterising… <span class=\"v\">{0}</span>/{1} ({2} drawn)" },
  "status.vec_rasterising_scan": { pt: "Rasterizando… <span class=\"v\">{0}</span> varridas, {1} desenhadas", en: "Rasterising… <span class=\"v\">{0}</span> scanned, {1} drawn" },
  "status.net_meta_drawn":   { pt: "<span class=\"v\">{0}</span> linhas desenhadas<br/><span class=\"v\">{1}</span> células de rede ({2}% da grade)", en: "<span class=\"v\">{0}</span> lines drawn<br/><span class=\"v\">{1}</span> network cells ({2}% of grid)" },
  "status.net_meta_zero":    { pt: "EPSG:{0} · varridas <span class=\"v\">{1}</span> feições, desenhadas {2} — <span style=\"color:#ff6b6b\">0 células neste DEM</span>", en: "EPSG:{0} · scanned <span class=\"v\">{1}</span> features, drew {2} — <span style=\"color:#ff6b6b\">0 cells on this DEM</span>" },
  "status.load_superseded":  { pt: "Carregamento cancelado — o DEM mudou durante a operação.", en: "Load cancelled — the DEM changed during the operation." },
  // Point picking / snapping
  "status.click_outside":    { pt: "Clique fora do DEM, ou DEM em CRS não geográfico (este protótipo só suporta DEMs EPSG:4326 — veja as notas).", en: "Click is outside the DEM, or DEM is in a non-geographic CRS (this prototype supports EPSG:4326 DEMs only — see notes)." },
  "status.click_nodata":     { pt: "A célula clicada é nodata.",                     en: "Clicked cell is nodata." },
  "status.net_no_snap_click":{ pt: "A rede carregada não tem células úteis neste DEM (verifique CRS/geometria) — não dá para agarrar cliques. Desmarque \"Restringir cálculo à rede\" ou limpe a rede para continuar.", en: "The loaded network has no usable cells on this DEM (check its CRS/geometry) — clicks can't be snapped. Untick \"Constrain compute to network\" or clear the network to continue." },
  "status.snap_failed_label":{ pt: "{0} não pode ser agarrado — a rede carregada não tem células úteis neste DEM (verifique CRS/geometria), ou desmarque \"Restringir cálculo à rede\".", en: "{0} can't be snapped — the loaded network has no usable cells on this DEM (check its CRS/geometry), or untick \"Constrain compute to network\"." },
  "status.refs_no_snap":     { pt: "Os pontos de referência não podem ser agarrados — a rede carregada não tem células úteis neste DEM, ou desmarque \"Restringir cálculo à rede\".", en: "Reference points can't be snapped — the loaded network has no usable cells on this DEM, or untick \"Constrain compute to network\"." },
  // Compute progress / backend / interp / graph
  "status.worker_error":     { pt: "Erro no worker: {0}",                            en: "Worker error: {0}" },
  "status.density_progress": { pt: "Calculando densidade: ref {0}/{1} ({2}%)",       en: "Computing density: ref {0}/{1} ({2}%)" },
  "status.computing_pct":    { pt: "Calculando… {0}%",                               en: "Computing… {0}%" },
  "status.time_left":        { pt: "{0} — faltam {1}",                               en: "{0} — {1} left" },
  "status.interpolating_net":   { pt: "Interpolando pela rede…",                     en: "Interpolating across the network…" },
  "status.interpolating_energy":{ pt: "Interpolando o campo de energia…",            en: "Interpolating energy field…" },
  "status.backend_computing":   { pt: "Calculando no backend nativo…",              en: "Computing on native backend…" },
  "status.backend_computing_elapsed":{ pt: "Calculando no backend nativo… {0} decorridos", en: "Computing on native backend… {0} elapsed" },
  "cloud.machine":         { pt: "Máquina da nuvem", en: "Cloud machine" },
  // Preços de referência ON-DEMAND em southamerica-east1 (jul/2026, ~R$5,50/US$;
  // N vCPUs ≈ N·US$0,068/h). A VM roda SPOT (60–90% mais barato, flutua) — os
  // rótulos são teto aproximado, não fatura. Recalcule se mover de região.
  "cloud.m8":              { pt: "8 vCPUs · 32 GB — ~R$ 3/h",    en: "8 vCPUs · 32 GB — ~R$3/h (~US$0.55)" },
  "cloud.m32":             { pt: "32 vCPUs · 128 GB — ~R$ 12/h", en: "32 vCPUs · 128 GB — ~R$12/h (~US$2.20)" },
  "cloud.m128":            { pt: "128 vCPUs · 512 GB — ~R$ 48/h", en: "128 vCPUs · 512 GB — ~R$48/h (~US$8.70)" },
  "status.cloud_computing":     { pt: "Calculando na nuvem…",                        en: "Computing in the cloud…" },
  "status.cloud_computing_elapsed":{ pt: "Calculando na nuvem… {0} decorridos",      en: "Computing in the cloud… {0} elapsed" },
  "status.backend_fallback": { pt: "Backend nativo indisponível — usando workers do navegador… (motivo: {0})", en: "Native backend unavailable — using browser workers… (reason: {0})" },
  "status.building_graph":   { pt: "Construindo o grafo da rede…",                   en: "Building network graph…" },
  "status.graph_done":       { pt: "Concluído em {0} ms (grafo: {1} nós, {2} arestas){3}.", en: "Done in {0} ms (graph: {1} nodes, {2} edges){3}." },
  "status.graph_route_note": { pt: " · {0} rota(s)",                                 en: " · {0} route(s)" },
  // Bundle / export
  "status.nothing_rendered": { pt: "Nada renderizado ainda — rode um cálculo primeiro.", en: "Nothing rendered yet — run a compute first." },
  "status.no_layers_export": { pt: "Nenhuma camada renderizada para exportar.",      en: "No rendered layers to export." },
  "status.exported_layers":  { pt: "Exportadas {0} camada(s) renderizada(s) ({1} MB).", en: "Exported {0} rendered layer(s) ({1} MB)." },
  "status.export_failed":    { pt: "Falha ao exportar: {0}",                         en: "Export failed: {0}" },
  "status.download_need_dem":{ pt: "Carregue um DEM, rode o Compute e então baixe.", en: "Load a DEM first, then run Compute, then download." },
  "status.download_need_compute":{ pt: "Nada para baixar ainda — clique em Compute primeiro.", en: "Nothing to download yet — click Compute first." },
  "status.jszip_failed":     { pt: "JSZip não carregou — verifique a rede/console.", en: "JSZip didn't load — check the network/console." },
  "status.building_bundle":  { pt: "Montando o bundle…",                            en: "Building bundle…" },
  "status.bundle_saved":     { pt: "Bundle salvo ({0} MB).",                         en: "Saved bundle ({0} MB)." },
  "status.download_failed":  { pt: "Falha ao baixar: {0}",                           en: "Download failed: {0}" },
  "status.reload_failed":    { pt: "Falha ao recarregar: {0}",                       en: "Reload failed: {0}" },
  "status.bundle_restored":  { pt: "Bundle restaurado do cache — todas as camadas salvas re-renderizadas. Sem recálculo.", en: "Bundle restored from cache — all saved layers re-rendered. No recompute needed." },
  "status.bundle_dem_mismatch":{ pt: "Tamanho do DEM não bate — o bundle era para {0}×{1}, o DEM carregado é {2}×{3}. Parâmetros aplicados; saídas binárias ignoradas. Carregue o DEM correspondente para restaurar as camadas.", en: "DEM size mismatch — bundle was for {0}×{1}, loaded DEM is {2}×{3}. Parameters applied; binary outputs skipped. Load the matching DEM to restore overlays." },
  "status.bundle_dem_mismatch_pending":{ pt: "DEM carregado ({0}×{1}) não corresponde ao bundle pendente ({2}×{3}) — carregue o DEM correspondente para restaurá-lo.", en: "DEM loaded ({0}×{1}) doesn't match the pending bundle ({2}×{3}) — load the matching DEM to restore it." },
  "status.bundle_dem_extent_mismatch":{ pt: "DEM tem o mesmo tamanho ({0}×{1}) do bundle, mas é de outra área — provavelmente outro recorte. Parâmetros aplicados; saídas binárias ignoradas. Carregue o DEM correto para restaurar as camadas.", en: "DEM matches the bundle's size ({0}×{1}) but covers a different area — likely a different tile. Parameters applied; binary outputs skipped. Load the correct DEM to restore overlays." },
  "status.bundle_params_loaded":{ pt: "Parâmetros do bundle carregados. Clique em Compute para reproduzir.", en: "Bundle parameters loaded. Click Compute to reproduce." },
  "status.bundle_need_dem":  { pt: "Bundle carregado. Agora carregue o DEM correspondente{0} e clique em Compute.", en: "Bundle loaded. Now load the matching DEM{0} and click Compute." },
  "status.bundle_loaded":    { pt: "Bundle carregado. Clique no mapa para definir o ponto de origem.", en: "Bundle loaded. Click on the map to set source point." },
  "status.bundle_graph_not_restored":{ pt: "Bundle de modo grafo: o resultado (graph_edges.geojson) não é restaurável e a rede vetorial não viaja no bundle — recarregue a rede (.gpkg/OSM) antes de recalcular, senão o Compute usa o motor raster.", en: "Graph-mode bundle: the result (graph_edges.geojson) can't be restored and the vector network doesn't travel with the bundle — reload the network (.gpkg/OSM) before recomputing, or Compute will silently fall back to the raster engine." },
  "locate.unavailable":  { pt: "Localização indisponível.",             en: "Location unavailable." },
  "locate.timeout":      { pt: "Tempo esgotado ao buscar localização.", en: "Location lookup timed out." },
  "locate.error":        { pt: "Erro ao buscar localização.",           en: "Location lookup failed." },
  "locate.unsupported":  { pt: "Geolocalização não suportada.",         en: "Geolocation not supported." },
  "help.title":          { pt: "Como funciona", en: "How it works" },

  // ---- Group: Load DEM --------------------------------------------------
  "group.io":            { pt: "0. Importar / Exportar dados", en: "0. Import / Export data" },
  "group.inputs":        { pt: "1. Dados de entrada", en: "1. Input data" },
  "group.compute":       { pt: "2. Configuração do cálculo", en: "2. Compute setup" },
  "group.execution":     { pt: "2C. Execução", en: "2C. Execution" },
  "config.hint":         { pt: "Configuração (todos os controles):", en: "Settings (all toggles & values):" },
  "config.export":       { pt: "Exportar config", en: "Export config" },
  "config.import":       { pt: "Importar config", en: "Import config" },
  "config.reset":        { pt: "Restaurar padrões", en: "Reset to defaults" },
  "config.imported":     { pt: "Configuração importada.", en: "Config imported." },
  "config.import_error": { pt: "Falha ao importar a configuração", en: "Failed to import config" },
  "config.reset_confirm":{ pt: "Restaurar todas as configurações para os padrões? A página será recarregada.", en: "Reset all settings to defaults? The page will reload." },
  "group.load_dem":      { pt: "1A. Carregar DEM", en: "1A. Load DEM" },
  "examples.heading":    { pt: "ou baixar (localmente) um exemplo:", en: "or download (locally) an example:" },
  "ex.aguapreta":        { pt: "Entorno da Água Preta", en: "Água Preta surroundings" },
  "ex.centro":           { pt: "Sampa Centro Expandido", en: "São Paulo central area" },
  "ex.geral":            { pt: "Sampa Sítio Urbano",    en: "São Paulo urban site" },
  "ex.fabdem":           { pt: "Carregar FABDEM para a janela atual", en: "Load FABDEM for current viewport" },
  "ex.tag.aguapreta":    { pt: "~2 MB · imediato",      en: "~2 MB · instant" },
  "ex.tag.centro":       { pt: "~34 MB · rápido",       en: "~34 MB · fast" },
  "ex.tag.geral":        { pt: "~540 MB · lento",       en: "~540 MB · slow" },
  "ex.tag.fabdem":       { pt: "≤ 50 MB",                en: "≤ 50 MB" },
  "dem.no_dem":          { pt: "Nenhum DEM carregado.", en: "No DEM loaded." },
  "dem.meta_size":       { pt: "<span class=\"v\">{0} × {1}</span> células, célula {2}", en: "<span class=\"v\">{0} × {1}</span> cells, cell {2}" },
  "dem.meta_origin":     { pt: "origem <span class=\"v\">{0}</span>", en: "origin <span class=\"v\">{0}</span>" },
  "dem.meta_coverage":   { pt: "{0} de cobertura", en: "{0} coverage" },
  "bundle.reload_hint":  { pt: "Restaurar bundle (.zip) ou .jsonld:", en: "Reload a saved bundle (.zip) or .jsonld:" },

  // ---- Group: Vector network -------------------------------------------
  "group.network":       { pt: "1B. Rede vetorial opcional (.gpkg)", en: "1B. Optional vector network (.gpkg)" },
  "net.line_width":      { pt: "largura da linha (células)", en: "line width (cells)" },
  "net.snap_radius":     { pt: "raio de snap (células)", en: "snap radius (cells)" },
  "net.clear":           { pt: "Limpar rede",  en: "Clear network" },
  "net.render_width":    { pt: "largura da linha (m)", en: "line width (m)" },
  "net.constrain":       { pt: "Restringir cálculo à rede", en: "Constrain compute to network" },
  "net.graph_mode":      { pt: "Usar grafo viário ao invés de rasterizado", en: "Use road graph instead of rasterized" },
  "net.junctions":       { pt: "junções", en: "junctions" },
  "net.junctions_crossings": { pt: "nos cruzamentos", en: "at crossings" },
  "net.junctions_shared":    { pt: "extremos comuns", en: "shared endpoints" },
  "net.osm":             { pt: "Puxar ruas do OSM (highway=*)", en: "Pull streets from OSM (highway=*)" },
  "net.fgb":             { pt: "Puxar viário do FGB (América do Sul · nuvem)", en: "Pull streets from FGB (South America · cloud)" },
  "status.fgb_querying": { pt: "Consultando o FGB do viário (só os bytes da janela, via HTTP Range)…", en: "Querying the road FGB (only the view's bytes, via HTTP Range)…" },
  "status.fgb_progress": { pt: "FGB: {0} vias lidas…", en: "FGB: {0} ways read…" },
  "status.fgb_no_ways":  { pt: "Nenhuma via do FGB na janela.", en: "No FGB ways in the view." },
  "status.fgb_failed":   { pt: "Consulta ao FGB falhou: {0}", en: "FGB query failed: {0}" },
  "status.fgb_too_big":  { pt: "Janela grande demais pro FGB (~{0}×{1} km; teto ~1°×1°, o mesmo do FABDEM) — aproxime o zoom.", en: "View too large for the FGB pull (~{0}×{1} km; cap ~1°×1°, same as FABDEM) — zoom in." },
  "imp.fgb":             { pt: "Puxar água do FGB (América do Sul · nuvem)", en: "Pull water from FGB (South America · cloud)" },
  "imp.fgb.title":       { pt: "As mesmas áreas d'água (natural=water / reservoir / riverbank) e rios (waterway=river) do pull do OSM, servidos do FlatGeobuf do projeto via HTTP Range — sem Overpass. SEM litoral: o mar não é preenchido (em DEM costeiro use o pull do OSM); rios em túnel não são filtrados (o FGB não traz a tag tunnel).", en: "The same water areas (natural=water / reservoir / riverbank) and rivers (waterway=river) as the OSM pull, served from the project's FlatGeobuf via HTTP Range — no Overpass. NO coastline: the open sea is not filled (use the OSM pull on coastal DEMs); tunnelled rivers are not filtered out (the FGB carries no tunnel tag)." },
  "bridge.fgb":          { pt: "Puxar do FGB (América do Sul · nuvem)", en: "Pull from FGB (South America · cloud)" },
  "bridge.fgb.title":    { pt: "As mesmas pontes/túneis de VIAS (highway=* com bridge/tunnel) do pull do OSM, servidas do FlatGeobuf via HTTP Range — sem Overpass. Sem elevações `ele` mapeadas (os apoios caem no DEM); estruturas ferroviárias não entram (o FGB só tem vias).", en: "The same ROAD bridges/tunnels (highway=* with bridge/tunnel) as the OSM pull, served from the FlatGeobuf via HTTP Range — no Overpass. No mapped `ele` elevations (abutments fall back to the DEM); railway structures are absent (the FGB is highway-only)." },
  "bridges.none_fgb":    { pt: "Nenhuma ponte/túnel de via no FGB na janela.", en: "No road bridges/tunnels in the FGB view." },
  "net.example_viario":  { pt: "Viário RMSampa", en: "RMSampa road network" },
  "net.example_viario_tag": { pt: "~145 MB · nuvem · dados © OpenStreetMap, ODbL", en: "~145 MB · cloud · data © OpenStreetMap, ODbL" },
  "help.p.network_osm":  { pt: "Consulta o Overpass sobre a vista atual ∩ extensão do DEM. Áreas grandes podem demorar ou estourar limites do Overpass — aproxime o zoom primeiro.", en: "Queries Overpass over the current map view ∩ DEM extent. Large areas can take a while or hit Overpass limits — zoom in first." },
  "net.compare":         { pt: "Comparar com cenário sem rede", en: "Compare with unconstrained" },
  "net.graph_constrain_locked": { pt: "No modo grafo o cálculo é sempre sobre a rede — \"restringir\" fica sempre ativo. \"Comparar\" continua disponível: compara com o cenário em raster sem a rede.", en: "In graph mode the compute is always on the network — \"constrain\" stays on. \"Compare\" is still available: it compares against the raster scenario without the network." },
  "layer.energy_source": { pt: "Cenário exibido (energia e passagens)", en: "Displayed scenario (energy & passes)" },
  "esrc.constrained":    { pt: "restrito à rede", en: "network-constrained" },
  "esrc.unconstrained":  { pt: "sem restrição", en: "unconstrained" },
  "esrc.difference":     { pt: "diferença (custo da rede)", en: "difference (network cost)" },
  "route.network":       { pt: "rota na rede", en: "network route" },
  "route.terrain":       { pt: "rota no terreno", en: "terrain route" },
  "route.delta":         { pt: "Δ rede − terreno", en: "Δ network − terrain" },
  "route.terrain_meta":  { pt: "rota no terreno E: <span class=\"v\">{0}</span>, L=<span class=\"v\">{1} km</span>", en: "terrain route E: <span class=\"v\">{0}</span>, L=<span class=\"v\">{1} km</span>" },
  "route.round_note":    { pt: "energia das rotas alternativas: apenas o trecho de ida", en: "alternative-route energies: outbound leg only" },
  "warn.dp_skipped":     { pt: "Caminho de comprimento restrito não calculado ({0}). Mostrando o caminho da Dijkstra invertida — tente um L maior (no mínimo ~a distância de Chebyshev entre origem e destino).", en: "Length-constrained DP did not run ({0}). Showing the inverted-Dijkstra path instead — try a larger L (at minimum ~Chebyshev distance between src and dst)." },
  "route.compare_metric_note": { pt: "Nota: a rota de terreno segue a grade 8-conectada (comprimento até ~8% acima do geométrico) e alturas por célula; a rota da rede usa o comprimento real das polilinhas — Δ pequenos ficam dentro dessa diferença metodológica.", en: "Note: the terrain route follows the 8-connected grid (length up to ~8% above the geometric path) and cell-centre heights; the network route uses true polyline lengths — small Δ values sit within that methodological difference." },
  // ---- ColorCET colormap dropdown optgroup labels ------------------------
  "cmap.grp.linear":       { pt: "Linear", en: "Linear" },
  "cmap.grp.diverging":    { pt: "Divergente", en: "Diverging" },
  "cmap.grp.rainbow":      { pt: "Arco-íris", en: "Rainbow" },
  "cmap.grp.isoluminant":  { pt: "Isoluminante", en: "Isoluminant" },
  "cmap.grp.cyclic":       { pt: "Cíclico", en: "Cyclic" },
  "cmap.grp.cb_linear":    { pt: "Segura p/ daltonismo, linear", en: "Colour-blind safe linear" },
  "cmap.grp.cb_diverging": { pt: "Segura p/ daltonismo, divergente", en: "Colour-blind safe diverging" },
  "cmap.grp.cb_cyclic":    { pt: "Segura p/ daltonismo, cíclica", en: "Colour-blind safe cyclic" },
  "cmap.grp.tritan_linear":    { pt: "Segura p/ tritanopia, linear", en: "Tritan-safe linear" },
  "cmap.grp.tritan_diverging": { pt: "Segura p/ tritanopia, divergente", en: "Tritan-safe diverging" },
  "cmap.grp.tritan_cyclic":    { pt: "Segura p/ tritanopia, cíclica", en: "Tritan-safe cyclic" },
  // ---- Stats panel (renderResult) + route/marker tooltips ---------------
  "stats.max_e":         { pt: "E máx: <span class=\"v\">{0}</span>", en: "max E: <span class=\"v\">{0}</span>" },
  "stats.time":          { pt: "tempo: <span class=\"v\">{0} ms</span>", en: "time: <span class=\"v\">{0} ms</span>" },
  "stats.max_passes":    { pt: "passes máx: <span class=\"v\">{0}</span>", en: "max passes: <span class=\"v\">{0}</span>" },
  "stats.routes_count":  { pt: "<span class=\"v\">{0}</span> rota(s):", en: "<span class=\"v\">{0}</span> route(s):" },
  "stats.shared":        { pt: ", compartilhada <span class=\"v\">{0}</span>", en: ", shared <span class=\"v\">{0}</span>" },
  "stats.path_e":        { pt: "E da rota: <span class=\"v\">{0}</span>", en: "path E: <span class=\"v\">{0}</span>" },
  "stats.length":        { pt: "distância: <span class=\"v\">{0} km</span>", en: "length: <span class=\"v\">{0} km</span>" },
  "stats.route_tooltip": { pt: "rota {0} · E {1} · {2} km", en: "route {0} · E {1} · {2} km" },
  "marker.src":          { pt: "Origem", en: "Source" },
  "marker.dst":          { pt: "Destino", en: "Destination" },
  // ---- Accessibility KPIs (pairwise ref↔ref matrix, density runs) --------
  "group.kpi":           { pt: "3B. Acessibilidade (KPIs 300 kJ)", en: "3B. Accessibility (300 kJ KPIs)" },
  "kpi.intro":           { pt: "Cada referência representa uma fração igual da população amostrada. Os KPIs leem a matriz de energia par-a-par do último cálculo de densidade — editar os limiares reavalia na hora, sem recalcular.", en: "Each reference stands for an equal share of the sampled population. The KPIs read the last density run's pairwise energy matrix — editing the thresholds re-evaluates instantly, no recompute." },
  "kpi.ek":              { pt: "E₁ (kJ)", en: "E₁ (kJ)" },
  "kpi.k":               { pt: "pessoas alcançáveis ≥", en: "reachable people ≥" },
  "kpi.ej":              { pt: "E₂ (kJ)", en: "E₂ (kJ)" },
  "kpi.j":               { pt: "% da população ≥", en: "% of population ≥" },
  "kpi.pop":             { pt: "população total M", en: "total population M" },
  "kpi.pop_census":      { pt: "população total M (do censo)", en: "total population M (from census)" },
  "kpi.out1":            { pt: "KPI 1 — <span class=\"v\">{0}%</span> da população alcança ≥ {1} pessoas com ≤ {2} kJ", en: "KPI 1 — <span class=\"v\">{0}%</span> of the population can access ≥ {1} people within ≤ {2} kJ" },
  "kpi.out1_need_pop":   { pt: "KPI 1 — informe a população total M (amostragem não-censitária)", en: "KPI 1 — enter the total population M (non-census sampling)" },
  "kpi.out2":            { pt: "KPI 2 — <span class=\"v\">{0}%</span> da população alcança ≥ {1}% da população com ≤ {2} kJ", en: "KPI 2 — <span class=\"v\">{0}%</span> of the population can access ≥ {1}% of the population within ≤ {2} kJ" },
  "kpi.meta":            { pt: "{0} referências · modo {1} · orçamento do cálculo: {2}", en: "{0} references · mode {1} · run budget: {2}" },
  "kpi.meta_no_budget":  { pt: "∞ (sem orçamento)", en: "∞ (no budget)" },
  "kpi.warn_budget":     { pt: "Atenção: limiar acima do orçamento do cálculo ({0} kJ) — além dele a matriz é truncada, então os KPIs são um piso (subestimam). Recalcule com orçamento ≥ ao maior limiar para valores exatos.", en: "Warning: threshold above the run's energy budget ({0} kJ) — the matrix is truncated beyond it, so the KPIs are a lower bound (underestimate). Re-run with a budget ≥ the largest threshold for exact values." },
  "kpi.backend_no_matrix": { pt: "Backend nativo desatualizado — sem matriz de acessibilidade nesta resposta. Atualize o backend ou use o cálculo no navegador.", en: "Native backend outdated — no accessibility matrix in this response. Update the backend or compute in the browser." },
  "kpi.refs_changed":    { pt: "As referências mudaram desde o cálculo — os marcadores não foram recoloridos (os KPIs abaixo valem para as referências do cálculo).", en: "References changed since the run — markers were not recolored (the KPIs below refer to the run's references)." },
  "kpi.marker_tooltip":  { pt: "ref {0} · alcança {1} pessoas (≤ {2} kJ)", en: "ref {0} · reaches {1} people (≤ {2} kJ)" },
  "kpi.marker_tooltip_frac": { pt: "ref {0} · alcança {1}% das referências (≤ {2} kJ)", en: "ref {0} · reaches {1}% of references (≤ {2} kJ)" },
  "btn.kpi_csv":         { pt: "Exportar CSV por referência", en: "Export per-reference CSV" },
  "btn.kpi_matrix_csv":  { pt: "Exportar matriz CSV", en: "Export matrix CSV" },
  "kpi.corr":            { pt: "correção de grade ×c", en: "grid correction ×c" },
  "kpi.corr.title":      { pt: "Infla os limiares E₁/E₂ por c para compensar a sobre-estimativa da grade de 8 direções (≈1,09–1,12 medido). 1,00 = desligada (piso conservador). Desnecessária com ≥16 direções.", en: "Inflates the E₁/E₂ thresholds by c to offset the 8-direction grid's overestimate (≈1.09–1.12 measured). 1.00 = off (conservative floor). Unnecessary with ≥16 directions." },
  "kpi.corr_note":       { pt: "Correção de grade ×{0} aplicada aos limiares — estimativa centrada: a garantia de piso conservador NÃO vale mais.", en: "Grid correction ×{0} applied to the thresholds — centered estimate: the conservative-floor guarantee NO longer holds." },
  // ---- Move directions + string pulling ----------------------------------
  "param.ndirs":         { pt: "Direções de movimento", en: "Move directions" },
  "param.ndirs.title":   { pt: "8 = grade clássica (padrão). Mais direções reduzem a sobre-estimativa de energia por serrilhado das rotas (≈⅔ a menos com 16), a custo de cálculo proporcional. Servido também pelo backend nativo/nuvem a partir da versão 0.2.0 (backends antigos calculam no navegador).", en: "8 = the classic grid (default). More directions shrink the route-jaggedness energy overestimate (≈⅔ less at 16) at proportional compute cost. Also served by the native/cloud backend from version 0.2.0 (older backends compute in-browser)." },
  "param.string_pull":   { pt: "Suavizar rotas exibidas (string pulling)", en: "Smooth displayed routes (string pulling)" },
  "param.string_pull.title": { pt: "Encurta pós-cálculo a rota exibida (e as top-N) ligando vértices por segmentos retos custeados pelo mesmo modelo — a energia mostrada é a soma integrada da própria linha. Ida-e-volta e maximizar ficam de fora.", en: "Post-hoc shortens the displayed route (and top-N) by joining vertices with straight segments costed by the same model — the shown energy is the line's own integrated sum. Round-trip and maximize are excluded." },
  "stats.pulled":        { pt: "rota suavizada (string pulling) — energia = soma integrada da linha exibida", en: "route smoothed (string pulling) — energy = the displayed line's own integrated sum" },
  "net.interp":          { pt: "Interpolar campo de energia", en: "Interpolate energy field" },
  "net.max_distance":    { pt: "distância máx (células)", en: "max distance (cells)" },
  "net.smoothing":       { pt: "suavizações", en: "smoothing iters" },
  "net.no_network":      { pt: "Nenhuma rede carregada.", en: "No network loaded." },

  // ---- Group: Impassable mask ------------------------------------------
  "group.impassable":    { pt: "1C. Máscara de barreira opcional (água)", en: "1C. Optional impassable mask (water)" },
  "imp.enabled":         { pt: "Aplicar ao cálculo", en: "Apply to compute" },
  "imp.invert":          { pt: "Inverter (raster marca células passáveis)", en: "Invert (raster marks passable cells)" },
  "imp.osm":             { pt: "Puxar água do OSM", en: "Pull water from OSM" },
  "imp.example_water":   { pt: "Águas RMSampa", en: "RMSampa water mask" },
  "imp.example_water_tag": { pt: "~2,4 MB · nuvem", en: "~2.4 MB · cloud" },
  "imp.rivers":          { pt: "Rios (linhas) intransponíveis", en: "Rivers (lines) impassable" },
  "imp.corridor":        { pt: "Rede abre corredores passáveis sobre a máscara", en: "Network carves passable corridors across the mask" },
  "imp.offset":          { pt: "deslocamento no centro da ponte (m, −5…+15)", en: "bridge centre offset (m, −5…+15)" },
  "imp.none":            { pt: "Nenhuma máscara carregada.", en: "No impassable mask loaded." },
  "imp.meta.cells":      { pt: "{0} células barradas ({1}% da grade)", en: "{0} impassable cells ({1}% of grid)" },
  "imp.meta.corridor":   { pt: "{0} células de corredor (pontes)", en: "{0} bridge-corridor cells" },
  "imp.cell_blocked":    { pt: "Célula intransponível (máscara de barreira) — escolha outra.", en: "Impassable cell (barrier mask) — pick another." },
  "help.h.impassable":   { pt: "Máscara de barreira", en: "Impassable mask" },

  // ---- Group: Bridges & tunnels ----------------------------------------
  "group.bridges":       { pt: "1D. Pontes e túneis opcionais (OSM)", en: "1D. Optional bridges & tunnels (OSM)" },
  "bridge.enabled":      { pt: "Aplicar ao cálculo", en: "Apply to compute" },
  "bridge.osm":          { pt: "Puxar pontes e túneis do OSM", en: "Pull bridges & tunnels from OSM" },
  "bridge.from_network": { pt: "Extrair da rede carregada", en: "Extract from loaded network" },
  "bridge.no_candidates":{ pt: "A rede carregada não tem pontes/túneis marcados (tags bridge/tunnel).", en: "The loaded network has no bridge/tunnel tags." },
  "bridge.tunnels":      { pt: "Incluir túneis (tunnel=yes)", en: "Include tunnels (tunnel=yes)" },
  "bridge.clear":        { pt: "Limpar portais", en: "Clear portals" },
  "draw.barrier":        { pt: "Desenhar barreira", en: "Draw barrier" },
  "draw.corridor":       { pt: "Desenhar corredor", en: "Draw corridor" },
  "draw.portal":         { pt: "Desenhar portal", en: "Draw portal" },
  "imp.erase_all":       { pt: "Apagar máscara e desenhos", en: "Erase mask & drawings" },
  "draw.erase_portal":   { pt: "Apagar portais desenhados", en: "Erase drawn portals" },
  "draw.need_dem":       { pt: "Carregue um DEM geográfico (lon/lat) antes de desenhar.", en: "Load a geographic (lon/lat) DEM before drawing." },
  "draw.drawing":        { pt: "Desenhando… clique para adicionar vértices, duplo-clique para concluir.", en: "Drawing… click to add vertices, double-click to finish." },
  "draw.barrier_added":  { pt: "Barreira adicionada ({0} no total).", en: "Barrier added ({0} total)." },
  "draw.corridor_added": { pt: "Corredor passável adicionado ({0} no total).", en: "Passable corridor added ({0} total)." },
  "draw.portal_added":   { pt: "Portal adicionado ({0} no total).", en: "Portal added ({0} total)." },
  "draw.portal_invalid": { pt: "Portal inválido (extremos fora do DEM, sobre nodata ou coincidentes).", en: "Invalid portal (endpoints off-DEM, on nodata, or coincident)." },
  "draw.cleared":        { pt: "Desenhos apagados.", en: "Drawings erased." },
  "draw.imp_meta":       { pt: "{0} barreira(s), {1} corredor(es) desenhado(s)", en: "{0} barrier(s), {1} corridor(s) drawn" },
  "draw.portal_meta":    { pt: "{0} portal(is) desenhado(s)", en: "{0} portal(s) drawn" },
  "draw.delete_this":    { pt: "Apagar este desenho", en: "Delete this drawing" },
  "bridge.none":         { pt: "Nenhuma ponte carregada.", en: "No bridges loaded." },
  "bridge.meta.count":   { pt: "{0} tabuleiros de ponte/túnel", en: "{0} bridge/tunnel decks" },
  "bridge.meta.skipped": { pt: "{0} ignorados (fora do DEM ou apoio sem dado)", en: "{0} skipped (off-DEM or nodata abutment)" },
  "help.h.bridges":      { pt: "Pontes e túneis", en: "Bridges & tunnels" },
  "help.p.bridges":      { pt: "Puxa pontes (bridge=*) e, opcionalmente, túneis (tunnel=yes) do OpenStreetMap sobre a extensão do DEM, ou extrai-os da rede vetorial já carregada (1b) que tenha tags bridge/tunnel (coluna ou other_tags). Cada estrutura é modelada como um tabuleiro plano entre seus dois apoios no solo: no cálculo em raster ela vira uma \"aresta-portal\" entre as células das pontas, com o custo do tabuleiro plano, sem alterar as células por baixo — então tanto a rota POR CIMA da ponte quanto a rota POR BAIXO ficam corretas. Pressupõe um DEM de terreno nu (sem o tabuleiro). No modo \"seguir os vetores\" (grafo), as pontes/túneis da própria rede (puxada do OSM) são achatadas e os cruzamentos em níveis diferentes não se conectam.", en: "Pulls bridges (bridge=*) and, optionally, tunnels (tunnel=yes) from OpenStreetMap over the DEM extent, or extracts them from the already-loaded vector network (1b) when it carries bridge/tunnel tags (a column or other_tags). Each structure is modelled as a level deck between its two ground abutments: in the raster compute it becomes a \"portal edge\" between the end cells at the flat-deck cost, without altering the cells underneath — so both the route OVER the bridge and the route UNDER it stay correct. Assumes a bare-earth DEM (deck not in the terrain). In \"follow the vectors\" (graph) mode, the network's own bridges/tunnels (pulled from OSM) are flattened and crossings at different layers don't connect." },
  "help.p.impassable":   { pt: "Suba um GeoTIFF binário (1=intransponível, p.ex. corpos d'água). É reamostrado para a grade do DEM por maioria de área (≥50% intransponível ⇒ célula barrada); fora da extensão da máscara assume-se passável. Pode estar em extensão/resolução/CRS diferentes do DEM. Opcionalmente, a rede vetorial (1b) abre corredores passáveis (pontes) sobre a máscara, com um deslocamento suave de elevação que sobe linearmente das margens até o centro da ponte.", en: "Upload a binary GeoTIFF (1=impassable, e.g. water bodies). It is resampled onto the DEM grid by area-coverage majority (≥50% impassable ⇒ blocked cell); outside the mask extent cells are assumed passable. It may have a different extent/resolution/CRS than the DEM. Optionally the vector network (1b) carves passable corridors (bridges) across the mask, with a smooth elevation offset that ramps linearly from the shores up to the bridge centre." },

  // ---- Group: Pick points ----------------------------------------------
  "group.pick_points":   { pt: "2B. Pontos e referências", en: "2B. Points & references" },
  "pts.click_map":       { pt: "— clicar mapa —", en: "— click map —" },
  "pts.optional":        { pt: "— opcional —",  en: "— optional —" },
  "pts.click_again":     { pt: "— clicar novamente —", en: "— click again —" },
  "pts.density":         { pt: "— densidade —", en: "— density —" },
  "pts.clear":           { pt: "Limpar pontos", en: "Clear points" },

  // ---- Group: Parameters -----------------------------------------------
  "group.parameters":    { pt: "2A. Parâmetros", en: "2A. Parameters" },
  "param.mode":          { pt: "Modo", en: "Mode" },
  "mode.from":           { pt: "Saindo da fonte",     en: "From source" },
  "mode.to":             { pt: "Vindo até a fonte",  en: "To source point" },
  "mode.round":          { pt: "Ida e volta",         en: "Round trip" },
  "param.mass":          { pt: "Massa (kg)", en: "Mass (kg)" },
  "param.crr":           { pt: "Resistência ao rolamento (Crr)", en: "Rolling resistance (Crr)" },
  "param.cda":           { pt: "Área de arrasto (CdA, m²)", en: "Drag area (CdA, m²)" },
  "param.rho":           { pt: "Densidade do ar (ρ, kg/m³)", en: "Air density (ρ, kg/m³)" },
  "param.keff":          { pt: "Eficiência da transmissão", en: "Drivetrain efficiency" },
  "param.pflat":         { pt: "Potência no plano (W)", en: "Power on the flat (W)" },
  "param.climbthr":      { pt: "Limiar de subida (%)", en: "Climb threshold (%)" },
  "param.ksmooth":       { pt: "Suavização k_s", en: "Smoothing k_s" },
  "param.deadband":      { pt: "Deadband de elev. (m)", en: "Elev. deadband (m)" },
  "param.alphar":        { pt: "α_r rolamento (kJ/m)", en: "α_r rolling (kJ/m)" },
  "param.alphaa":        { pt: "α_a arrasto, plano (kJ/m)", en: "α_a aero, flat (kJ/m)" },
  "param.betaro":        { pt: "β subida (kJ/m)", en: "β climb (kJ/m)" },
  "param.budget":        { pt: "Orçamento de energia (kJ)", en: "Energy budget (kJ)" },
  "param.budget_mode":   { pt: "Orçamento aplica-se a", en: "Budget applies to" },
  "budget.leg":          { pt: "por perna", en: "each leg" },
  "budget.total":        { pt: "ida e volta", en: "round trip" },
  "help.p.budget_mode":  { pt: "Só no modo ida-e-volta. \"Cada perna\": célula visível se ida ≤ orçamento E volta ≤ orçamento (total pode chegar a 2×). \"Total\": ida + volta ≤ orçamento. A contagem de passagens conta apenas trajetos até células exibidas (dentro do orçamento); células-corredor ainda acumulam os trajetos que passam por elas. Perto da fronteira do orçamento as subárvores ficam truncadas e a contagem fica sistematicamente mais baixa ali; células cuja alcançabilidade é cortada pela borda do DEM sofrem o mesmo viés — compare corredores só bem dentro do orçamento e longe das bordas.", en: 'Round-trip mode only. "Each leg": a cell is shown if out ≤ budget AND back ≤ budget (totals can reach 2×). "Total": out + back ≤ budget. The passes count only counts trajectories to displayed (within-budget) cells; corridor cells still accumulate the trajectories passing through them. Near the budget frontier subtrees are truncated and the count is systematically lower there; cells whose reachability is clipped by the DEM border carry the same bias — compare corridors only well inside the budget and away from the edges.' },
  "param.want_topn":     { pt: "Calcular top-N rotas", en: "Compute top-N routes" },
  "param.want_density":  { pt: "Calcular densidade multi-referência", en: "Compute multi-reference density" },
  "param.backend_url":   { pt: "URL do backend", en: "Backend URL" },
  // ---- Compute source (three-way: navegador / localhost / nuvem) --------
  "param.compute_source":  { pt: "Fonte de cálculo", en: "Compute source" },
  "cs.browser":            { pt: "Navegador (workers na página)", en: "Browser (in-page workers)" },
  "cs.localhost":          { pt: "Localhost (Rust nativo)", en: "Localhost (native Rust)" },
  "cs.cloud":              { pt: "Nuvem (VM orquestrada)", en: "Cloud (orchestrated VM)" },
  "param.orchestrator_url":{ pt: "URL do orquestrador", en: "Orchestrator URL" },
  "param.cloud_token":     { pt: "Senha da nuvem", en: "Cloud password" },
  "cloud.idle":            { pt: "VM da nuvem parada.", en: "Cloud VM stopped." },
  "cloud.starting":        { pt: "Iniciando a VM da nuvem… (~{0})", en: "Starting cloud VM… (~{0})" },
  "cloud.ready":           { pt: "VM da nuvem pronta ({0} núcleos).", en: "Cloud VM ready ({0} cores)." },
  "cloud.stopping":        { pt: "Parando a VM da nuvem…", en: "Stopping cloud VM…" },
  "cloud.stopped_after":   { pt: "VM da nuvem parada após o cálculo.", en: "Cloud VM stopped after the run." },
  "cloud.stop_skipped":    { pt: "VM da nuvem mantida ligada — outra sessão está usando.", en: "Cloud VM kept running — another session is using it." },
  "cloud.orch_unreachable":{ pt: "Orquestrador inacessível — usando workers do navegador…", en: "Orchestrator unreachable — using browser workers…" },
  "cloud.boot_failed":     { pt: "Falha ao iniciar a VM da nuvem — usando workers do navegador…", en: "Cloud VM failed to start — using browser workers…" },
  "cloud.preempted":       { pt: "Nuvem indisponível — recalculando no navegador… (motivo: {0})", en: "Cloud unavailable — recomputing in the browser… (reason: {0})" },
  "cloud.transfer":        { pt: "Transferência: ↑ {0} · ↓ {1} · ~{2}", en: "Transfer: ↑ {0} up · ↓ {1} down · ~{2}" },
  "cloud.need_orch_url":   { pt: "Informe a URL do orquestrador para usar a nuvem.", en: "Enter the orchestrator URL to use Cloud." },
  "cloud.need_password":   { pt: "Informe a senha da nuvem para usar a nuvem.", en: "Enter the cloud password to use Cloud." },
  "cloud.auth_failed":     { pt: "Senha da nuvem incorreta — usando workers do navegador…", en: "Wrong cloud password — using browser workers…" },
  "cloud.creating":        { pt: "Criando a VM da nuvem… (~{0})", en: "Creating cloud VM… (~{0})" },
  "cloud.keep_warm":       { pt: "Manter VM ligada entre cálculos", en: "Keep VM warm between runs" },
  "cloud.warm":            { pt: "VM ligada — esfria após ~15 min de ócio (watchdog na VM).", en: "VM kept warm — auto-stops after ~15 min idle (in-VM watchdog)." },
  "cloud.size_mismatch":   { pt: "VM pronta com {0} vCPUs — a seleção de {1} vCPUs só vale no próximo boot (desligue a VM pra aplicar já).", en: "VM ready with {0} vCPUs — the {1}-vCPU selection only applies on the next boot (stop the VM to apply it now)." },
  "cloud.stop_now":        { pt: "Desligar VM agora", en: "Stop VM now" },
  "cloud.no_fallback":     { pt: "Falhar em vez de cair pro navegador", en: "Fail instead of falling back to browser" },
  "cloud.backend_old_ndirs": { pt: "backend {0} não serve direções ≠ 8 (precisa ≥ 0.2.0; pedido: {1})", en: "backend {0} doesn't serve directions ≠ 8 (needs ≥ 0.2.0; requested: {1})" },
  "cloud.failed_hard":     { pt: "cálculo na nuvem falhou (fallback desligado): {0}", en: "cloud compute failed (fallback disabled): {0}" },
  "cloud.stopping_manual": { pt: "Desligando a VM… o próximo cálculo religa no tamanho selecionado.", en: "Stopping the VM… the next compute boots the selected size." },
  "help.p.backend":      { pt: "Fonte de cálculo: três opções (2C). <em>Navegador</em> (padrão) roda em Web Workers na própria aba. <em>Localhost</em> fala com um servidor Rust opcional (backend/ no repositório, cargo run --release) na máquina do usuário. <em>Nuvem</em> aciona sob demanda uma VM no orquestrador — um serviço Cloud Run público, alcançável de qualquer origem —, protegida pela \"senha da nuvem\" compartilhada; \"Manter VM ligada entre cálculos\" evita religá-la a cada cálculo, mas ela desliga sozinha após ~15 min de ócio (watchdog dentro da própria VM), e cada cálculo com ela ligada é cobrado na conta do mantenedor. O seletor <em>\"Máquina da nuvem\"</em> escolhe o tamanho da VM (8/32/128 vCPUs, com preço de referência por hora — a VM roda em modo spot, tipicamente 60–90% mais barato que o valor mostrado); o tamanho é aplicado ao criar/religar a VM (uma VM já ligada mantém o tamanho até o próximo desligamento — o aviso de estado indica quando a seleção difere da VM ligada, e <em>\"Desligar VM agora\"</em> força a troca no próximo cálculo) e a estimativa de tempo modela o tamanho selecionado. Localhost e Nuvem aceleram tanto a densidade multi-referência (uma Dijkstra por referência, em todos os núcleos) quanto o campo de energia de fonte única (de/para/ida-e-volta); rotas (top-N), caminho até o destino e o modo grafo continuam sempre no navegador (nenhum backend produz rotas). Se o servidor ou a VM ficarem inacessíveis, o app volta para os workers do navegador, dizendo o motivo na linha de status — a menos que <em>\"Falhar em vez de cair pro navegador\"</em> esteja marcado, caso em que o cálculo aborta com o erro (útil pra não mascarar problemas da nuvem nem recomputar um DEM enorme no laptop sem querer).", en: "Compute source: three options (2C). <em>Browser</em> (default) runs in in-page Web Workers. <em>Localhost</em> talks to an optional Rust server (backend/ in the repo, cargo run --release) on the user's own machine. <em>Cloud</em> boots a VM on demand via the orchestrator — a public Cloud Run service, reachable from any origin — gated by the shared \"cloud password\"; \"Keep VM warm between runs\" avoids rebooting it on every run, but it still auto-stops after ~15 min idle (a watchdog inside the VM), and every run while it's up is billed to the maintainer's account. The <em>\"Cloud machine\"</em> selector picks the VM size (8/32/128 vCPUs, with a per-hour reference price — the VM runs as spot, typically 60–90% cheaper than shown); the size applies when the VM is created/restarted (a running VM keeps its size until the next stop — the status hint flags when the selection differs from the running VM, and <em>\"Stop VM now\"</em> forces the switch on the next compute) and the time estimate models the selected size. Localhost and Cloud both accelerate multi-reference density (one Dijkstra per reference, across all cores) AND the single-source energy field (from/to/round). Top-N routes, the destination path, and graph mode always stay in the browser (no backend produces routes). If the server or VM is unreachable, the app falls back to the in-browser workers, stating the reason in the status line — unless <em>\"Fail instead of falling back to browser\"</em> is ticked, in which case the run aborts with the error (useful to not mask cloud problems or accidentally recompute a huge DEM on the laptop)." },
  "param.max_workers":   { pt: "Máx. de workers de cálculo (0 = auto)", en: "Max compute workers (0 = auto)" },
  "help.p.workers":      { pt: "Avançado: paraleliza a densidade entre este número de Web Workers. 0 = auto (dimensionado pelos núcleos e memória disponível). Só aumente se sua máquina tiver mais RAM do que o navegador reporta — cada worker usa cerca de 5 GB em um DEM grande, então exceder pode travar a aba.", en: "Advanced: parallelise density across this many Web Workers. 0 = auto (sized to cores and available memory). Only raise it if your machine has more RAM than the browser reports — each worker needs roughly 5 GB on a large DEM, so over-committing can crash the tab." },
  // dormant: no UI control since v37 (engine/backend still implement the mode) — kept for param.max_length below
  "param.maximize":      { pt: "Maximizar energia (inverter otimização)", en: "Maximize energy (reverse optimization)" },
  "param.max_length":    { pt: "Comprimento L (arestas, 0 = sem restrição)", en: "Path length L (edges, 0 = unconstrained)" },
  "param.n_refs":        { pt: "N referências", en: "N references" },
  "help.p.ref_direction": { pt: "A direção segue o Modo acima.", en: "Direction follows the Mode above." },
  "ref.place_random":    { pt: "Distribuir aleatórias", en: "Place random" },
  "param.sampling":      { pt: "Estratégia de amostragem", en: "Sampling strategy" },
  "sampling.uniform":    { pt: "uniforme (pseudoaleatória)", en: "uniform (pseudo-random)" },
  "sampling.sobol":      { pt: "Sobol (quase-aleatória)", en: "Sobol (quasi-random)" },
  "sampling.census":     { pt: "Censo IBGE 2022 (densidade populacional)", en: "IBGE 2022 census (population density)" },
  "help.p.sampling":     { pt: "Sequências quase-aleatórias (QMC) cobrem a área uniformemente sem aglomerados nem vazios — melhor convergência da densidade com menos referências. Cliques sucessivos continuam a sequência em vez de repeti-la. <strong>Censo IBGE 2022</strong> amostra as referências por densidade populacional (onde as pessoas moram): busca os setores censitários dentro do DEM na nuvem e sorteia pontos ponderados pela população — só funciona para DEMs no Brasil e exige internet.", en: "Quasi-random (QMC) sequences cover the area evenly, without the clumps and gaps of pseudo-random — the density converges with fewer references. Successive clicks continue the sequence rather than repeat it. <strong>IBGE 2022 census</strong> samples references by population density (where people actually live): it fetches the census sectors inside the DEM from the cloud and draws population-weighted points — Brazil-only DEMs, and it needs a network connection." },
  "census.fetching":     { pt: "Buscando setores censitários…", en: "Fetching census sectors…" },
  "census.placed":       { pt: "{0} referências distribuídas por população (Censo 2022).", en: "{0} references placed by population (2022 census)." },
  "census.placed.skipped": { pt: "{0} referências distribuídas por população ({1} fora do DEM ignoradas).", en: "{0} references placed by population ({1} skipped outside the DEM)." },
  "census.no_dem":       { pt: "Carregue um DEM antes de amostrar pelo censo.", en: "Load a DEM before census sampling." },
  "census.geographic":   { pt: "A amostragem por censo exige um DEM geográfico (lon/lat).", en: "Census sampling requires a geographic (lon/lat) DEM." },
  "census.outside_brazil": { pt: "O DEM está fora da cobertura do censo (Brasil).", en: "The DEM is outside census coverage (Brazil)." },
  "census.no_setores":   { pt: "Nenhum setor censitário com população na extensão do DEM.", en: "No populated census sectors in the DEM extent." },
  "census.no_points":    { pt: "Os pontos do censo caíram fora do DEM ou em células sem dado.", en: "The census points fell outside the DEM or on nodata cells." },
  "census.fetch_failed": { pt: "Falha ao buscar setores censitários: {0}", en: "Failed to fetch census sectors: {0}" },
  "census.lib_missing":  { pt: "Biblioteca FlatGeobuf indisponível (offline?). Reconecte e recarregue.", en: "FlatGeobuf library unavailable (offline?). Reconnect and reload." },
  "ref.clear":           { pt: "Limpar referências", en: "Clear refs" },
  "ref.none":            { pt: "nenhuma referência marcada", en: "no references placed" },
  "ref.count":           { pt: "{0} referência(s) marcada(s)", en: "{0} reference(s) placed" },
  "ref.show_markers":    { pt: "Mostrar marcadores de referência", en: "Show reference markers" },
  "ref.load_file":       { pt: "Carregar referências (GeoJSON)", en: "Load reference points (GeoJSON)" },
  "help.p.ref_file":     { pt: "Carregue um GeoJSON de pontos (Point), ex.: census/points.geojson. Cada ponto vira uma referência; pontos fora do DEM são ignorados. Substitui as referências atuais; limite de 2000.", en: "Load a GeoJSON of Point features (e.g. census/points.geojson). Each point becomes a reference; points outside the DEM are skipped. Replaces the current references; capped at 2000." },
  "ref.loaded":          { pt: "{0} referências carregadas de {1}.", en: "Loaded {0} reference points from {1}." },
  "ref.loaded.skipped":  { pt: "{0} referências carregadas de {1} ({2} fora do DEM ignoradas).", en: "Loaded {0} reference points from {1} ({2} skipped outside the DEM)." },
  "ref.load.no_dem":     { pt: "Carregue um DEM antes de carregar referências.", en: "Load a DEM before loading reference points." },
  "ref.load.geographic": { pt: "Carregar referências por arquivo exige um DEM geográfico (lon/lat).", en: "Loading reference points requires a geographic (lon/lat) DEM." },
  "ref.load.no_points":  { pt: "Nenhum ponto válido dentro do DEM em {0}.", en: "No valid points inside the DEM in {0}." },
  "ref.load.parse_error":{ pt: "Falha ao ler o GeoJSON: {0}", en: "Could not read the GeoJSON: {0}" },
  "param.n_routes":      { pt: "N (1–20)", en: "N (1–20)" },
  "param.penalty":       { pt: "penalidade / força", en: "penalty / strength" },
  "param.repulsion":     { pt: "Modo de repulsão", en: "Repulsion mode" },
  // Screen-reader names for the opacity sliders (no visible label of their
  // own — they sit beside the layer checkbox). Applied via data-i18n-aria.
  "rep.per_cell":        { pt: "por célula (penalidade^usadas)", en: "per-cell (penalty^used)" },
  "rep.linear":          { pt: "linear 1/(d+1)", en: "linear 1/(d+1)" },
  "rep.square":          { pt: "quadrática 1/(d²+1)", en: "square 1/(d²+1)" },
  "param.routes_cmap":   { pt: "Colormap das rotas", en: "Routes colormap" },
  "param.field_cmap":    { pt: "Colormap do campo", en: "Field colormap" },

  // ---- Compute -----------------------------------------------------------
  "btn.compute":         { pt: "Calcular", en: "Compute" },

  // ---- Group: Result ----------------------------------------------------
  "group.result":        { pt: "3. Resultados", en: "3. Results" },
  "group.result_stats":          { pt: "3A. Estatísticas", en: "3A. Statistics" },
  "group.result_energy":         { pt: "3B. Campo de energia", en: "3B. Energy field" },
  "group.result_density":        { pt: "3C. Densidade de trajetos", en: "3C. Trajectory density" },
  "group.result_density_net":    { pt: "3C.a. Densidade de trajetos na rede vetorial", en: "3C.a. Trajectory density on the vector network" },
  "group.result_density_terrain":{ pt: "3C.b. Densidade de trajetos no terreno", en: "3C.b. Trajectory density on the terrain" },
  "group.result_legend":         { pt: "3D. Legenda", en: "3D. Legend" },
  "btn.refresh_style":   { pt: "Atualizar estilo", en: "Refresh style" },
  "result.empty":        { pt: "—", en: "—" },
  "layer.tiles":         { pt: "rmsampa-v2 tiles", en: "rmsampa-v2 tiles" },
  "layer.bridges":       { pt: "Pontes e túneis", en: "Bridges & tunnels" },
  "help.p.tiles":        { pt: '<a href="https://telhas.pedalhidrografi.co/rmsampa-v2/" target="_blank" rel="noopener" style="color: var(--accent-2);">Tiles XYZ</a> de pedalhidrografi.co.', en: '<a href="https://telhas.pedalhidrografi.co/rmsampa-v2/" target="_blank" rel="noopener" style="color: var(--accent-2);">XYZ tiles</a> from pedalhidrografi.co.' },
  "help.p.relief":       { pt: "Camada de relevo do DEM: cmocean.phase, p5–p80 · declividade 0–p80 (γ=1.2) multiplicada.", en: "DEM relief layer: cmocean.phase, p5–p80 · slope 0–p80 (γ=1.2) multiplied." },
  "vmin.label":          { pt: "min (auto = p1)", en: "min (auto = p1)" },
  "vmax.label":          { pt: "max (auto = p80)", en: "max (auto = p80)" },
  "vmin.passes":         { pt: "min (auto = p10)", en: "min (auto = p10)" },
  "vmax.passes":         { pt: "max (auto = p90)", en: "max (auto = p90)" },
  "help.p.energy_range": { pt: "Faixa da energia: Auto = recorte por percentil (p1–p80) mapeado linearmente para as cores. Fixar min e/ou max substitui o limite automático correspondente (clamping) — o mapeamento continua linear, só muda onde ele recorta.", en: "Energy range: Auto = percentile clip (p1–p80) mapped linearly to colour. Pinning min and/or max replaces the corresponding automatic bound (clamping) — the mapping stays linear, only the clip point changes." },
  "layer.basemap":       { pt: "Mapa base", en: "Basemap" },
  "basemap.osm":         { pt: "OSM (padrão)", en: "OSM (default)" },
  "basemap.dark":        { pt: "OSM minimalista preto", en: "OSM minimalist black" },
  "basemap.light":       { pt: "OSM minimalista branco", en: "OSM minimalist white" },
  "basemap.black":       { pt: "sem mapa base (tudo preto)", en: "no basemap (all black)" },
  "basemap.white":       { pt: "sem mapa base (tudo branco)", en: "no basemap (all white)" },
  "basemap.gray":        { pt: "sem mapa base (tudo cinza)", en: "no basemap (all gray)" },
  "basemap.satellite":   { pt: "Satélite (Esri)", en: "Satellite (Esri)" },
  "order.title":         { pt: "Controle de camadas", en: "Layer control" },
  "layer.ctrl_open":     { pt: "Controle de camadas", en: "Layer control" },
  "resizer.title":       { pt: "Arraste para 1–4 colunas (duplo-clique alterna)", en: "Drag to set 1–4 columns (double-click cycles)" },
  "status.dismiss":      { pt: "Dispensar", en: "Dismiss" },
  // Accessible names / tooltips (icon buttons, file pickers, layer rows) + a few
  // strings that used to be hardcoded (calibration, gate reasons, budget hint).
  "drawer.toggle":       { pt: "Mostrar/ocultar painel", en: "Show/hide panel" },
  "lang.toggle.aria":    { pt: "Mudar idioma", en: "Switch language" },
  "modal.close":         { pt: "Fechar", en: "Close" },
  "aria.dem_file":       { pt: "Carregar DEM", en: "Load DEM" },
  "aria.vector_file":    { pt: "Carregar rede vetorial", en: "Load vector network" },
  "aria.mask_file":      { pt: "Carregar máscara de barreira", en: "Load barrier mask" },
  "aria.bundle_file":    { pt: "Importar bundle", en: "Import bundle" },
  "layer.opacity":       { pt: "opacidade", en: "opacity" },
  "order.move_up":       { pt: "Mover para cima", en: "Move up" },
  "order.move_down":     { pt: "Mover para baixo", en: "Move down" },
  "estimate.calibrating":{ pt: "≈ estimando…", en: "≈ estimating…" },
  "param.budget.title":  { pt: "≤0 = ∞ (sem orçamento)", en: "≤0 = ∞ (no budget)" },
  "param.budget.maximize_title": { pt: "Sem efeito ao maximizar: os custos são invertidos (outra unidade), então o orçamento em kJ não se aplica.", en: "No effect under maximize: costs are inverted (different units), so the kJ budget doesn't apply." },
  "compute.need_dem":    { pt: "Carregue um DEM primeiro", en: "Load a DEM first" },
  "compute.need_src":    { pt: "Clique no mapa para definir a origem", en: "Click the map to set the source" },
  "compute.need_ref":    { pt: "Defina ao menos 1 ponto de referência", en: "Place at least 1 reference point" },
  "help.modal_title":    { pt: "Simulador bici-geo-energético", en: "Bike-geo-energy simulator" },
  "order.hint":          { pt: "O topo da lista é desenhado por cima. Marcadores e tooltips ficam sempre acima. Aplicado na hora; lembrado neste dispositivo.", en: "Top of the list is drawn on top. Markers and tooltips always stay above. Applied immediately; remembered on this device." },
  "order.reset":         { pt: "Restaurar padrão", en: "Reset to default" },
  "order.relief":        { pt: "Relevo (DEM)", en: "Relief (DEM)" },
  "order.impassable":    { pt: "Máscara de barreira", en: "Impassable mask" },
  "order.energy":        { pt: "Energia", en: "Energy" },
  "order.network":       { pt: "Rede vetorial (linhas)", en: "Vector network (lines)" },
  "order.passes":        { pt: "Passagens", en: "Passes" },
  "order.refgeom":       { pt: "Geometria de referência", en: "Reference geometry" },
  "order.routes":        { pt: "Rotas / caminho", en: "Routes / path" },
  "layer.refgeom":       { pt: "Geometria de referência", en: "Reference geometry" },
  "refgeom.upload":      { pt: "Carregar trilha GPX", en: "Upload GPX track" },
  "refgeom.distance":    { pt: "Distância", en: "Distance" },
  "refgeom.energy":      { pt: "Energia total", en: "Total energy" },
  "refgeom.ascent":      { pt: "Subida total", en: "Total ascent" },
  "refgeom.descent":     { pt: "Descida total", en: "Total descent" },
  "refgeom.no_elevation":{ pt: "Sem dados de elevação (a trilha não traz elevação e não há DEM sob ela).", en: "No elevation data (the track carries no elevation and there's no DEM under it)." },
  "refgeom.loading":     { pt: "Lendo trilha GPX…", en: "Reading GPX track…" },
  "refgeom.loaded":      { pt: "Geometria de referência: {0} ({1} km).", en: "Reference geometry: {0} ({1} km)." },
  "refgeom.parse_error": { pt: "Arquivo GPX inválido.", en: "Invalid GPX file." },
  "refgeom.too_short":   { pt: "A trilha GPX precisa de ao menos 2 pontos.", en: "The GPX track needs at least 2 points." },
  "passes.gamma":        { pt: "γ gama (1 = sem mudança)", en: "γ gamma (1 = no change)" },
  "passes.mean_window":  { pt: "filtro média N", en: "mean filter N" },
  "passes.blend":        { pt: "Blend", en: "Blend" },
  "blend.add":           { pt: "soma de cores (plus-lighter)", en: "add colors (plus-lighter)" },
  "blend.sum_data":      { pt: "soma de dados (A+B numa paleta)", en: "data sum (A+B, one palette)" },
  "blend.normal":        { pt: "normal", en: "normal" },
  "blend.screen":        { pt: "screen", en: "screen" },
  "blend.multiply":      { pt: "multiply", en: "multiply" },
  "blend.overlay":       { pt: "overlay", en: "overlay" },
  "blend.energy":        { pt: "cor da energia (passagens = opacidade)", en: "energy color (passes = opacity)" },
  "help.p.compare":      { pt: "<em>\"Comparar com cenário sem rede\"</em> (1B) roda o cálculo duas vezes: uma restrita à rede (ou ao grafo), outra livre no raster sem restrição — e o seletor <em>\"Cenário exibido\"</em> (painel de camadas, 3B) escolhe qual energia/passagens aparecem: <em>restrito à rede</em>, <em>sem restrição</em>, ou <em>diferença</em> (custo da rede, com as passagens dos dois cenários sobrepostas — ver abaixo). A rota/energia de terreno usa a grade 8-conectada (comprimento até ~8% acima do geométrico) — Δ pequenos na diferença ficam dentro dessa diferença metodológica, não são necessariamente um custo físico real de ficar na rede.", en: "<em>\"Compare with unconstrained\"</em> (1B) runs the compute twice: once constrained to the network (or graph), once free on the unconstrained raster — and the <em>\"Displayed scenario\"</em> picker (layer panel, 3B) chooses which energy/passes are shown: <em>network-constrained</em>, <em>unconstrained</em>, or <em>difference</em> (network cost, with both scenarios' passes overlaid — see below). The terrain route/energy comes from the 8-connected grid (length up to ~8% above the geometric path) — small Δ values in the difference view sit within that methodological gap, not necessarily a real physical cost of staying on the network." },
  "help.p.passes_dual":  { pt: "Vista de diferença: o canal AZUL (terreno, cenário sem restrição) — deixar em branco usa o mesmo valor do canal LARANJA (rede, cenário com restrição). As duas cores são complementares aditivas (somam branco), então onde os dois cenários passam juntos o brilho é máximo; cada cor sozinha fica no eixo azul–amarelo, discriminável mesmo com daltonismo vermelho-verde.", en: "Difference view: the BLUE channel (terrain, unconstrained scenario) — leave blank to use the same value as the ORANGE channel (network, constrained). The two colours are additive complements (they sum to white), so where both scenarios route together brightness is maximal; each colour alone sits on the blue–yellow axis, discriminable even with red–green colour-blindness." },
  "help.p.passes_blend": { pt: "Mistura das passagens: rampa cinza; com \"soma de cores\" (plus-lighter), células de alta passagem clareiam o que está pintado abaixo — é uma soma de CORES contra todo o fundo (basemap incluso), escalada pela opacidade, então satura pro branco sobre mapa claro. \"Soma de dados\" soma os CAMPOS célula a célula (na vista de diferença: com rede + sem rede) e pinta a soma numa paleta só, em composição normal — escala honesta, independente do basemap (indisponível no modo grafo, onde um canal é vetorial). \"Cor da energia\" pinta os corredores com o colormap do campo de energia e usa as passagens como opacidade — min/max/γ moldam a rampa de alfa. Mesmo comportamento auto/pinado da Energia.", en: 'Greyscale ramp; with "add colors" (plus-lighter) high-pass cells brighten whatever is painted beneath — it adds COLORS against the whole backdrop (basemap included), scaled by opacity, so it saturates to white over a light basemap. "Data sum" adds the FIELDS cell by cell (in the difference view: constrained + unconstrained) and paints the sum on one palette with normal compositing — honest scale, basemap-independent (unavailable in graph mode, where one channel is vector). "Energy color" paints corridors with the energy field\'s colormap and uses passes for opacity — min/max/γ shape the alpha ramp. Same auto / pinned-range behaviour as Energy.' },
  "btn.range_reset":     { pt: "Reset auto", en: "Reset ranges to auto" },
  "btn.download_bundle": { pt: "Baixar bundle (.zip)", en: "Download bundle (.zip)" },
  "btn.export_rendered": { pt: "Exportar imagens renderizadas (.zip)", en: "Export rendered images (.zip)" },
  "btn.export_refs":     { pt: "Exportar referências (GeoJSON)", en: "Export references (GeoJSON)" },
  "ref.export_empty":    { pt: "Nenhuma referência para exportar.", en: "No references to export." },
  "io.inputs_hint":      { pt: "Dados de entrada (1A–1D), mesmo formato na ida e volta:", en: "Input datasets (1A–1D), same format both ways:" },
  "io.export_dem":       { pt: "Exportar DEM (.tif)", en: "Export DEM (.tif)" },
  "io.import_dem":       { pt: "Importar DEM (.tif)", en: "Import DEM (.tif)" },
  "io.export_network":   { pt: "Exportar rede (.gpkg)", en: "Export network (.gpkg)" },
  "io.import_network":   { pt: "Importar rede (.gpkg)", en: "Import network (.gpkg)" },
  "io.export_mask":      { pt: "Exportar máscara (.tif)", en: "Export mask (.tif)" },
  "io.import_mask":      { pt: "Importar máscara (.tif)", en: "Import mask (.tif)" },
  "io.export_bridges":   { pt: "Exportar pontes (.gpkg)", en: "Export bridges (.gpkg)" },
  "io.import_bridges":   { pt: "Importar pontes (.gpkg)", en: "Import bridges (.gpkg)" },
  "io.exported":         { pt: "{0} exportado.", en: "{0} exported." },
  "io.no_dem":           { pt: "Nenhum DEM carregado para exportar.", en: "No DEM loaded to export." },
  "io.no_mask":          { pt: "Nenhuma máscara carregada para exportar.", en: "No mask loaded to export." },
  "io.no_network":       { pt: "Nenhuma rede carregada para exportar.", en: "No network loaded to export." },
  "io.no_bridges":       { pt: "Nenhuma ponte carregada para exportar.", en: "No bridges loaded to export." },
  "io.no_dem_first":     { pt: "Carregue um DEM antes de importar pontes.", en: "Load a DEM before importing bridges." },
  "io.gpkg_invalid":     { pt: "Arquivo .gpkg inválido (sem gpkg_geometry_columns).", en: "Invalid .gpkg (no gpkg_geometry_columns)." },
  "io.gpkg_no_lines":    { pt: "Nenhuma linha encontrada no .gpkg.", en: "No line features found in the .gpkg." },
  "bridges.need_geographic": { pt: "As pontes precisam de um DEM geográfico (lon/lat).", en: "Bridges need a geographic (lon/lat) DEM." },
  "bridges.osm_need_geographic": { pt: "Puxar pontes do OSM precisa de um DEM geográfico (lon/lat).", en: "OSM bridge pull needs a geographic (lon/lat) DEM." },
  "bridges.pull_failed":     { pt: "Falha ao puxar pontes do OSM: {0}", en: "OSM bridge pull failed: {0}" },
  "bridges.none_overpass":   { pt: "O Overpass não retornou pontes/túneis nesta extensão.", en: "Overpass returned no bridges/tunnels in this extent." },
  "bridges.none_usable":     { pt: "{0}: nenhuma ponte/túnel utilizável neste DEM.", en: "{0}: no usable bridges/tunnels on this DEM." },
  "bridges.loaded":          { pt: "{0} tabuleiro(s) de ponte/túnel carregado(s).", en: "{0} bridge/tunnel deck(s) loaded." },
  "ref.export_done":     { pt: "{0} referência(s) exportada(s).", en: "Exported {0} reference(s)." },
  "credit":              { pt: "feito por Cláudio e dirigido pelos neogeógrafos geomorfológicos", en: "made by Cláudio, directed by the geomorphological neo-geographers" },

  // ---- Help modal -------------------------------------------------------
  "help.usage_heading":  { pt: "Como usar", en: "How to use" },
  "help.theory_heading": { pt: "O que estamos fazendo", en: "What we're doing" },
  "help.h.load_dem":     { pt: "Carregar um DEM", en: "Load a DEM" },
  "help.p.load_dem":     { pt: "Use o seletor para abrir um GeoTIFF local, clique num exemplo hospedado, ou aperte <em>Carregar FABDEM para a janela atual</em> (puxa tiles FABDEM 1°×1° pela extensão visível, limite de 50 MB). O DEM aparece como retângulo tracejado e o mapa centra automaticamente. Com um DEM carregado, <em>Recortar à janela atual</em> extrai só a extensão visível (menos memória, cálculo mais rápido) e <em>Reduzir resolução</em> faz média de blocos N×N — num MDT de 5 m, 6× ≈ 30 m, o regime onde o modelo é mais preciso. Ambos passam pelo mesmo caminho de carga de um DEM novo (máscara, suavização, sondagem de tempo).", en: 'Use the file picker to open a local GeoTIFF, click a hosted example, or press <em>Load FABDEM for current viewport</em> (pulls FABDEM 1°×1° tiles for the visible extent, 50 MB cap). The DEM is shown as a dashed rectangle and the map auto-centres. With a DEM loaded, <em>Crop to current view</em> extracts just the visible extent (less memory, faster computes) and <em>Downsample</em> does N×N block averaging — on a 5 m DTM, 6× ≈ 30 m, the regime where the model is most accurate. Both go through the same load path as a fresh DEM (mask, smoothing, timing probe).' },
  "help.h.points":       { pt: "Marcar pontos", en: "Pick points" },
  "help.p.points":       { pt: "<strong>Modo padrão:</strong> clique no mapa para o ponto-fonte (<code>src</code>). Um segundo clique marca o destino (<code>dst</code>) — necessário para \"até a fonte\", \"ida e volta\" e \"top-N rotas\".", en: '<strong>Default mode:</strong> click the map for the source (<code>src</code>). A second click sets the destination (<code>dst</code>) — required for "to source point", "round trip", and "top-N routes".' },
  "help.p.density_pts":  { pt: "<strong>Densidade multi-referência:</strong> ative <em>Calcular densidade multi-referência</em>. Os cliques agora adicionam pontos numerados. Use \"Distribuir aleatórias\" ou ajuste <em>N referências</em>. Política FIFO: ao exceder N, o mais antigo é descartado.", en: '<strong>Multi-reference density:</strong> turn on <em>Compute multi-reference density</em>. Clicks now add numbered reference points. Use "Place random" or adjust <em>N references</em>. FIFO policy: above N, the oldest is dropped.' },
  "help.h.params":       { pt: "Parâmetros", en: "Parameters" },
  "help.p.params":       { pt: "Modelo de energia v2: <em>massa</em>, <em>Crr</em> (rolamento), <em>CdA</em> (arrasto), <em>ρ</em> (densidade do ar), <em>eficiência da transmissão</em> e <em>potência no plano</em> (que fixa a velocidade de plano) definem o custo por metro; o <em>limiar de subida</em> separa onde o arrasto deixa de ser cobrado. <em>Orçamento</em> poda caminhos acima de um limiar (≤0 = sem orçamento).", en: 'v2 energy model: <em>mass</em>, <em>Crr</em> (rolling), <em>CdA</em> (drag), <em>ρ</em> (air density), <em>drivetrain efficiency</em> and <em>power on the flat</em> (which sets the flat speed) define the cost per metre; the <em>climb threshold</em> marks where aero stops being charged. <em>Budget</em> prunes paths above a threshold (≤0 = no budget).' },
  "help.h.compute":      { pt: "Calcular", en: "Compute" },
  "help.p.compute":      { pt: "Aperte <em>Calcular</em>. Habilitado quando há fonte (modo padrão) ou pelo menos uma referência (modo densidade). Estimativa de tempo aparece antes; durante a execução, a barra mostra o tempo restante.", en: 'Hit <em>Compute</em>. Enabled when a source is set (default mode) or at least one reference (density mode). A time estimate appears beforehand; during the run, the bar shows time remaining.' },
  "help.h.viz":          { pt: "Visualização", en: "Visualisation" },
  "help.p.viz":          { pt: "As camadas <em>Energia</em> e <em>Passagens</em> têm visibilidade, opacidade e blend independentes. Mudanças de colormap, range, gamma, filtro média e blend ficam pendentes até <em>Atualizar estilo</em> — evita re-renderizar a cada digitação em DEMs grandes.", en: 'The <em>Energy</em> and <em>Passes</em> layers have independent visibility, opacity, and blend. Changes to colormap, range, gamma, mean filter, and blend stay pending until you click <em>Refresh style</em> — saves re-rendering on every keystroke for large DEMs.' },
  "help.h.bundle":       { pt: "Salvar / restaurar", en: "Save / reload" },
  "help.p.bundle":       { pt: "<em>Baixar bundle (.zip)</em> empacota um <code>metadata.jsonld</code> com todos os parâmetros, mais GeoTIFFs georeferenciados (energy.tif, passes.tif, network.tif, impassable.tif) que abrem direto no QGIS. Para reproduzir: carregue o mesmo DEM, depois leia o JSON-LD ou ZIP. No modo \"até\", as rotas/caminho exportados (routes.geojson, path.geojson) têm coordenadas escritas origem→destino, mas a energia foi pontuada destino→referência — cada feição traz uma propriedade <code>direction</code> explicando isso.", en: '<em>Download bundle (.zip)</em> packs a <code>metadata.jsonld</code> with every parameter, plus georeferenced GeoTIFFs (energy.tif, passes.tif, network.tif, impassable.tif) that open directly in QGIS. To reproduce: load the same DEM, then read the JSON-LD or ZIP back. In "to" mode, the exported routes/path (routes.geojson, path.geojson) have coordinates written source→destination, but the energy was scored destination→reference — each feature carries a <code>direction</code> property spelling this out.' },
  "help.p.io_group":     { pt: "O grupo <em>\"0. Importar / Exportar dados\"</em> guarda três coisas separadas do bundle acima: <em>Exportar/Importar config</em> troca um JSON só com os parâmetros e toggles (sem dados geográficos) — útil para replicar a configuração noutro DEM; <em>Resetar para padrões</em> descarta esses ajustes; e, por dataset, <em>exportar/importar</em> o DEM (.tif), a rede (.gpkg), a máscara de barreira (.tif) e as pontes (.gpkg) — o mesmo formato usado para carregar cada um em 1A–1D, então o que sai daqui recarrega direto ali.", en: "The <em>\"0. Import / Export data\"</em> group holds three things separate from the bundle above: <em>Export/Import config</em> swaps a JSON with just the parameters and toggles (no geographic data) — handy for replaying the same setup on a different DEM; <em>Reset to defaults</em> discards those tweaks; and, per dataset, <em>export/import</em> the DEM (.tif), network (.gpkg), impassable mask (.tif), and bridges (.gpkg) — the same format used to load each one in 1A–1D, so what comes out here reloads straight back in there." },
  "help.h.cost":         { pt: "Modelo de custo assimétrico", en: "Asymmetric cost model" },
  "help.p.cost":         { pt: "Cada movimento entre células adjacentes (4 cardeais + 4 diagonais) custa em kJ, pelo modelo v2: os parâmetros físicos (massa total <em>m</em>, <em>Crr</em>, <em>CdA</em>, <em>ρ</em>, eficiência <em>k_eff</em>, potência de cruzeiro no plano, limiar de subida, suavização) são reduzidos uma vez ao pacote <code>{a_rol, a_aero, β, limiar, α/β, ε_offset}</code> (kJ/m e kJ). Com <code>Δh = h_v − h_u</code> e <code>d</code> a distância no chão:", en: 'Each move between adjacent cells (4 cardinal + 4 diagonal) costs kJ, per the v2 model: the physical parameters (total mass <em>m</em>, <em>Crr</em>, <em>CdA</em>, <em>ρ</em>, efficiency <em>k_eff</em>, cruise power on the flat, climb threshold, smoothing) are folded once into the bundle <code>{a_roll, a_aero, β, threshold, α/β, ε_offset}</code> (kJ/m and kJ). With <code>Δh = h_v − h_u</code> and <code>d</code> the ground distance:' },
  "help.formula":        { pt: "subida (Δh ≥ 0):  a_rol·d + (a_aero·d se rampa < limiar) + β·Δh\ndescida (Δh < 0): max(0, a_rol·d + a_aero·d − ε·β·|Δh|)\nε = clamp₀₁(min(1, (α/β)·d/|Δh|) − 0.13)",
                           en: "uphill (Δh ≥ 0):   a_roll·d + (a_aero·d if grade < threshold) + β·Δh\ndownhill (Δh < 0): max(0, a_roll·d + a_aero·d − ε·β·|Δh|)\nε = clamp₀₁(min(1, (α/β)·d/|Δh|) − 0.13)" },
  "help.p.cost_extra":   { pt: "Nos padrões (75 kg, Crr 0.008, CdA 0.45, ρ 1.1, k_eff 0.97, 80 W no plano), <code>β = m·g/k_eff ≈ 0.76 kJ/m</code> de subida — com <code>g = 9,7864 m/s²</code>, a gravidade <em>local</em> de São Paulo (gravimetria absoluta do IAG-USP), não os 9,81 de livro-texto; o arrasto (<code>a_aero</code>) só é cobrado abaixo do <em>limiar de subida</em> (2%) — subindo forte a velocidade cai e o arrasto some. Na descida a recuperação <code>ε</code> depende da rampa: descidas suaves devolvem quase todo o custo de resistência, descidas íngremes não devolvem nada (nunca abaixo de zero).", en: 'At the defaults (75 kg, Crr 0.008, CdA 0.45, ρ 1.1, k_eff 0.97, 80 W on the flat), <code>β = m·g/k_eff ≈ 0.76 kJ/m</code> of climb — with <code>g = 9.7864 m/s²</code>, São Paulo\'s <em>local</em> gravity (IAG-USP absolute gravimetry), not the textbook 9.81; aero (<code>a_aero</code>) is only charged below the <em>climb threshold</em> (2%) — on a steep climb speed drops and drag vanishes. Downhill the recovery <code>ε</code> depends on grade: gentle descents refund most of the resistance cost, steep ones refund nothing (never below zero).' },
  "help.p.cost_resolution": { pt: "O modelo v2 funciona melhor sobre relevo <em>tratado</em>. Em MDTs crus a energia lida sai conservadoramente ALTA e rotas com muita descida acabam relativamente mais penalizadas, porque a recuperação <code>ε</code> é calculada por rampa local e o ruído do relevo fabrica micro-descidas íngremes que a política grade-local se recusa a creditar. Desde a v64 o app aplica, ao carregar <em>qualquer</em> MDT (fino ou grosso, FABDEM incluso), uma <em>suavização</em> gaussiana estática (σ = 30 m, controlável em 1A) — a prática recomendada validada no journal do bicycling-energy-model (Entry 74: nos mapas σ30-tratados o ε grade-local vence toda célula do contraste de políticas; era σ = 10 m só em MDTs finos desde a v55/Entry 20). A precisão fina vem de <em>calibrar os parâmetros</em> (CdA, Crr, k_s) nos seus próprios percursos: com calibração, o erro validado fica abaixo de ±5% com viés < ±2% (procedimento no journal).", en: 'The v2 model behaves best on <em>treated</em> terrain. On raw DTMs energies read conservatively HIGH, and descent-heavy routes end up relatively over-charged, because the <code>ε</code> recovery is computed per local grade and terrain noise manufactures steep micro-descents the grade-local policy refuses to credit. Since v64 the app applies, when loading <em>any</em> DTM (fine or coarse, FABDEM included), a static Gaussian <em>smoothing</em> (σ = 30 m, controllable in 1A) — the recommended practice validated in the bicycling-energy-model journal (Entry 74: on σ30-treated maps the grade-local ε wins every cell of the policy contest; it was σ = 10 m on fine DTMs only since v55/Entry 20). Fine accuracy comes from <em>calibrating the parameters</em> (CdA, Crr, k_s) on your own rides: calibrated, the validated error is under ±5% with bias < ±2% (procedure in the journal).' },
  "param.dem_smooth":    { pt: "Suavização do MDT", en: "DEM smoothing" },
  "demsmooth.auto":      { pt: "auto (σ = 30 m em todas as fontes)", en: "auto (σ = 30 m on all sources)" },
  "demsmooth.off":       { pt: "desligada", en: "off" },
  "status.dem_smoothing": { pt: "Suavizando MDT (σ = {0} m)…", en: "Smoothing DEM (σ = {0} m)…" },
  "dem.crop":            { pt: "Recortar DEM à janela atual", en: "Crop DEM to current view" },
  "dem.crop_label":      { pt: "{0} · recorte {1}×{2}", en: "{0} · crop {1}×{2}" },
  "status.crop_need_geo": { pt: "Recorte só funciona em DEMs geográficos (lon/lat) — este DEM é projetado.", en: "Crop only works on geographic (lon/lat) DEMs — this DEM is projected." },
  "status.crop_no_overlap": { pt: "A janela atual não intersecta o DEM.", en: "The current view doesn't intersect the DEM." },
  "status.crop_noop":    { pt: "A janela atual cobre o DEM inteiro — nada a recortar.", en: "The current view covers the whole DEM — nothing to crop." },
  "status.crop_too_small": { pt: "Recorte pequeno demais (mínimo 2×2 células) — aproxime menos.", en: "Crop too small (minimum 2×2 cells) — zoom out a little." },
  "dem.downsample":      { pt: "Reduzir resolução", en: "Downsample" },
  "dem.downsample_label": { pt: "{0} · média {1}× {2}×{3}", en: "{0} · {1}× avg {2}×{3}" },
  "aria.downsample_factor": { pt: "Fator de redução de resolução", en: "Downsample factor" },
  "status.downsampling": { pt: "Reduzindo resolução (média {0}×)…", en: "Downsampling ({0}× block average)…" },
  "status.downsample_too_small": { pt: "Resultado pequeno demais ({0}×{1} células) — use um fator menor.", en: "Result too small ({0}×{1} cells) — use a smaller factor." },
  "help.h.field":        { pt: "Campo de energia", en: "Energy field" },
  "help.p.field":        { pt: "Dijkstra sobre todas as células passáveis a partir do ponto-fonte (ou para o ponto-destino, com arestas reversas) dá o custo mínimo de chegar a cada célula. É isso que a camada <em>Energia</em> renderiza.", en: 'Dijkstra over all passable cells starting from the source (or terminating at the destination, with reversed edges) gives the minimum cost to reach each cell. That\'s what the <em>Energy</em> layer renders.' },
  "help.h.modes":        { pt: "Modos", en: "Modes" },
  "help.p.modes":        { pt: "<em>Saindo da fonte</em>: campo direto a partir de <code>src</code>. <em>Vindo até a fonte</em>: campo reverso para <code>dst</code> — útil em terreno assimétrico (subir é mais caro que descer). <em>Ida e volta</em>: soma ida + volta, custo total de \"ir e voltar\" passando por cada célula.", en: '<em>From source</em>: forward field from <code>src</code>. <em>To source point</em>: reverse field arriving at <code>dst</code> — useful on asymmetric terrain (climbing costs more than descending). <em>Round trip</em>: forward + reverse summed, the total cost of going there and back through each cell.' },
  "help.h.passes":       { pt: "Contagem de passagens", en: "Passes count" },
  "help.p.passes":       { pt: "Para cada célula <code>c</code>, quantos caminhos ótimos passam por <code>c</code> — o tamanho da subárvore enraizada em <code>c</code> na árvore de caminhos mínimos. Destaca corredores naturais (\"autoestradas\") da paisagem energética. Em empates exatos de custo, qual dos caminhos empatados é creditado é um artefato da ordem de busca — a densidade e o backend nativo desempatam de forma idêntica, mas os modos de ponto único podem escolher diferente; em terreno plano e simétrico, corredores podem mudar entre execuções/motores sem que isso signifique nada sobre a topografia.", en: 'For each cell <code>c</code>, how many optimal paths pass through it — the size of the subtree rooted at <code>c</code> in the shortest-path tree. Highlights the natural corridors ("highways") of the energy landscape. On exactly-tied optimal costs, which of the tied paths gets credited is a search-order artefact — density and the native backend break ties identically, but the single-point modes may pick differently; on flat, symmetric terrain corridors can shift between runs/engines without meaning anything about the topography.' },
  "help.h.topn":         { pt: "Top-N rotas", en: "Top-N routes" },
  "help.p.topn":         { pt: "A* com penalização iterativa: encontra a rota ótima, multiplica o componente de custo por distância (<code>a_rol·d + a_aero·d</code>) das células reusadas por uma penalidade, repete N vezes. Modos de repulsão: <em>por célula</em> (penaliza só células reusadas, bordas duras), <em>linear</em> (1/(d+1), suave e ampla), <em>quadrática</em> (1/(d²+1), suave e local).", en: 'A* with iterative penalisation: find the optimal route, multiply the distance-cost component (<code>a_roll·d + a_aero·d</code>) of its cells by a penalty, repeat N times. Repulsion modes: <em>per-cell</em> (only re-used cells get penalised, sharp), <em>linear</em> (1/(d+1), soft and wide), <em>square</em> (1/(d²+1), soft and local).' },
  "help.h.density":      { pt: "Densidade multi-referência", en: "Multi-reference density" },
  "help.p.density":      { pt: "Para K pontos de referência: para cada um, computa as passagens, normaliza por <code>H·W</code>, soma; depois divide por <code>H·W</code> de novo. O resultado destaca corredores comuns entre múltiplas origens — útil para mapear \"onde a topografia força a passagem\". A camada de energia neste modo é a média por célula sobre as referências que conseguem alcançá-la. Perto da fronteira do orçamento (quando houver) ou da borda do DEM, o alcance de cada referência é cortado e as passagens ficam sistematicamente mais baixas ali; quando o orçamento (ou a borda) satura a maioria das referências, a densidade tende à uniformidade e as diferenças se achatam.", en: 'For K reference points: for each one, compute passes, normalise by <code>H·W</code>, sum; then divide by <code>H·W</code> again. The output highlights corridors common across multiple sources — useful for mapping "where topography forces traffic to converge". The energy layer in this mode is the per-cell mean across the references that can reach it. Near the budget frontier (when set) or the DEM border, each reference\'s reach is clipped and passes are systematically lower there; when the budget (or the border) saturates most references, density flattens toward uniform and differences wash out.' },
  "help.h.network":      { pt: "Restrição por rede vetorial (.gpkg)", en: "Vector network constraint (.gpkg)" },
  "help.p.network":      { pt: "Quando um arquivo de linhas vetoriais é carregado, toda a análise fica restrita às células tocadas por essas linhas — Dijkstra ignora qualquer célula fora da rede, e cliques no mapa \"agarram\" para a célula de rede mais próxima dentro do raio de snap configurado. O exemplo \"Viário RMSampa\" é dado © OpenStreetMap, licença ODbL.", en: 'When a vector-line file is loaded, the analysis is constrained to cells touched by those lines — Dijkstra ignores any cell outside the network, and map clicks "snap" to the nearest network cell within the configured snap radius. The "Viário RMSampa" example is data © OpenStreetMap, ODbL licence.' },
  "help.p.network_extra":{ pt: "<strong>Largura da linha</strong> (em células) controla a espessura do carimbo durante a rasterização. <strong>Raio de snap</strong> é a distância máxima (em células) que o clique procura uma célula de rede antes de desistir. As coordenadas das linhas são reprojetadas via <code>proj4js</code> para o CRS do DEM antes da rasterização.", en: '<strong>Line width</strong> (in cells) controls the stamp thickness during rasterisation. <strong>Snap radius</strong> is the maximum distance (in cells) a click searches for a network cell before giving up. Line coordinates are reprojected via <code>proj4js</code> to the DEM CRS before rasterising.' },
  "help.h.graph":        { pt: "Grafo da rede (seguir os vetores)", en: "Network graph (follow the vectors)" },
  "help.p.graph":        { pt: "Com <em>\"Usar grafo viário ao invés de rasterizado\"</em> (1B) ligado, o cálculo troca de motor: em vez do raster 8-conectado, roda sobre o grafo das próprias linhas vetoriais — nós nos vértices e nas junções, arestas custadas pelo mesmo modelo assimétrico ao longo de cada segmento. \"Restringir\" fica sempre ligado e travado (o cálculo já é só sobre a rede); \"comparar com cenário sem rede\" continua disponível. <strong>Junções</strong> controla como cruzamentos viram nós: <em>nos cruzamentos</em> também conecta interseções geométricas calculadas (viadutos coplanares se conectam, cruzamentos em nível diferente não); <em>extremos comuns</em> só conecta onde as linhas já compartilham um vértice coincidente. Pontes/túneis da própria rede (puxados do OSM) são achatados a um tabuleiro reto entre seus apoios — mesmos dados do 1D, mas sem aresta-portal. O snap de clique no grafo usa um raio fixo de 15 m, independente do \"raio de snap\" (em células) do 1B, que só vale no modo raster.", en: "With <em>\"Use road graph instead of rasterized\"</em> (1B) on, the compute switches engines: instead of the 8-connected raster, it runs over the graph of the vector lines themselves — nodes at vertices and junctions, edges costed by the same asymmetric model along each segment. \"Constrain\" is forced on and locked (the compute is already network-only); \"compare with unconstrained\" is still available. <strong>Junctions</strong> controls how crossings become nodes: <em>at crossings</em> also connects computed geometric intersections (co-planar overpasses connect, different-level crossings don't); <em>shared endpoints</em> only connects where lines already share a coincident vertex. The network's own bridges/tunnels (pulled from OSM) are flattened to a straight deck between their abutments — same 1D data, but no portal edge. Click-snapping on the graph uses a fixed 15 m radius, independent of 1B's \"snap radius\" (in cells), which only applies to the raster mode." },
  "help.h.interp":       { pt: "Interpolação fora da rede", en: "Off-network interpolation" },
  "help.p.interp":       { pt: "Visualização opcional: preenche células fora da rede com a média dos valores da rede em redor, usando o mesmo algoritmo do GDAL <code>fillnodata</code>. Para cada célula vazia, busca em 8 direções até achar uma célula de rede dentro de <strong>distância máx</strong> (em células); calcula a média ponderada por <code>1/d²</code> dos acertos. Em seguida, aplica <strong>suavizações</strong> passes de média 3×3 sobre o preenchimento — preservando os valores originais da rede.", en: 'Optional visualisation: fills off-network cells with a weighted mean of nearby on-network values, using the same algorithm as GDAL <code>fillnodata</code>. For each empty cell, scan 8 directions for a network cell within <strong>max distance</strong> (cells); compute a <code>1/d²</code>-weighted mean of the hits. Then apply <strong>smoothing iters</strong> 3×3 mean passes over the fill, preserving the original network values.' },
  "help.p.interp_only":  { pt: "Apenas para visualização; a análise (Dijkstra, top-N, densidade) continua estritamente sobre a rede.", en: 'For visualisation only; the analysis (Dijkstra, top-N, density) stays strictly on the network.' },
  "help.h.changelog":    { pt: "Histórico de versões (changelog, em inglês)", en: "Changelog" },
  "help.h.impl":         { pt: "Implementação", en: "Implementation" },
  "help.p.impl":         { pt: "JS puro, em Web Worker: Dijkstra 8-conectada com heap binária sobre arrays tipados (<code>Float64Array</code> de prioridades + <code>Int32Array</code> de payloads). Tudo o que precisa de Δh assimétrico, passes count, top-N e densidade roda no mesmo motor.", en: 'Pure JS in a Web Worker: 8-connected Dijkstra on a binary heap over typed arrays (<code>Float64Array</code> for priorities + <code>Int32Array</code> for payloads). Everything — asymmetric Δh, passes count, top-N, density — runs on the same engine.' },
  "help.h.attribution":  { pt: "Atribuições", en: "Attributions" },
  "help.p.attribution":  { pt: "Mapa com <a href='https://leafletjs.com' target='_blank' rel='noopener'>Leaflet</a> e <a href='https://github.com/geoman-io/leaflet-geoman' target='_blank' rel='noopener'>Leaflet-Geoman</a>. Camadas base: © <a href='https://www.openstreetmap.org/copyright' target='_blank' rel='noopener'>OpenStreetMap</a> contribuidores, © <a href='https://carto.com/attributions' target='_blank' rel='noopener'>CARTO</a>, © Esri — Maxar, Earthstar Geographics. Hidrografia soterrada (rmsampa-v2): <a href='https://pedalhidrografi.co' target='_blank' rel='noopener'>pedalhidrografi.co</a>.", en: "Map with <a href='https://leafletjs.com' target='_blank' rel='noopener'>Leaflet</a> and <a href='https://github.com/geoman-io/leaflet-geoman' target='_blank' rel='noopener'>Leaflet-Geoman</a>. Base layers: © <a href='https://www.openstreetmap.org/copyright' target='_blank' rel='noopener'>OpenStreetMap</a> contributors, © <a href='https://carto.com/attributions' target='_blank' rel='noopener'>CARTO</a>, © Esri — Maxar, Earthstar Geographics. Buried hydrography (rmsampa-v2): <a href='https://pedalhidrografi.co' target='_blank' rel='noopener'>pedalhidrografi.co</a>." },
};

// localStorage access can throw in iOS Safari Private Browsing — feature
// detection via `typeof` isn't enough, since the object exists but the
// getter throws SecurityError.
let currentLang = "pt";
try {
  const saved = localStorage.getItem("simu-lang");
  if (saved === "pt" || saved === "en") currentLang = saved;
} catch {}

// Hook the language toggle uses to rebuild the layer-order panel's rows in
// place when it's open — the panel is a non-blocking corner panel that
// commonly stays open (it hosts the 3B-3D styling controls) across a
// language switch. Assigned inside the DOMContentLoaded closure (the panel's
// renderOrderList is a closure-scoped const, not a top-level function).
let refreshLayerOrderList = null;

// Same idea for the two colormap <select>s' optgroup labels — assigned once
// both exist (DOMContentLoaded), called from applyTranslations().
let refreshColormapLabels = null;

function t(key, ...args) {
  const entry = STRINGS[key];
  if (!entry) return key;            // unknown keys surface verbatim — easy to spot
  let s = entry[currentLang] ?? entry.en ?? key;
  if (args.length) {
    s = s.replace(/\{(\d+)\}/g, (_, i) => args[+i] ?? "");
  }
  return s;
}

// Structured worker warnings ({kind:"warning", key, args, message}) route
// through STRINGS/t() when a key is present; `message` (plain English) is the
// fallback for node harnesses / a cached pre-i18n worker that has no key.
function workerWarningText(m) {
  return m.key ? t(m.key, ...(m.args || [])) : m.message;
}

function applyTranslations() {
  document.documentElement.lang = currentLang === "pt" ? "pt-BR" : "en";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
    // #refresh-style also carries data-i18n="btn.refresh_style", so the
    // generic textContent set above would silently erase markStyleDirty()'s
    // " ●" pending-style cue (dataset.dirty stays "1" — only the visible
    // marker was lost) on every language toggle.
    if (el.id === "refresh-style" && el.dataset.dirty === "1") el.textContent += " ●";
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  // placeholder dos inputs de texto (hoje só a busca de endereços).
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  // aria-label for controls with no visible label of their own (e.g. the
  // layer opacity sliders) — kept in sync with the language toggle.
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });
  // The lang pill displays the OTHER language (the one a click would switch to)
  // — clearer affordance than showing the current language.
  const pill = document.getElementById("lang-tag");
  if (pill) pill.textContent = currentLang === "pt" ? "EN" : "PT";
  // Update <title> on the document so the OS / tab bar reflects the choice.
  document.title = t("title");
  // Leaflet's default zoom control renders its own hardcoded English
  // title/aria-label — retitle its buttons here so the toggle keeps them
  // in sync too (simpler than replacing the control with a custom one).
  const zoomIn  = document.querySelector(".leaflet-control-zoom-in");
  const zoomOut = document.querySelector(".leaflet-control-zoom-out");
  if (zoomIn)  { zoomIn.title  = t("map.zoom_in");  zoomIn.setAttribute("aria-label", t("map.zoom_in")); }
  if (zoomOut) { zoomOut.title = t("map.zoom_out"); zoomOut.setAttribute("aria-label", t("map.zoom_out")); }
}

function setLang(lang) {
  if (lang !== "pt" && lang !== "en") return;
  currentLang = lang;
  try { localStorage.setItem("simu-lang", lang); } catch {}
  // setLang is defined before `map` (const, further down the file) but only
  // ever CALLED after the whole script — and so `map` — has finished
  // initialising, so this is safe; the guard just documents that ordering.
  if (typeof map !== "undefined" && map.pm) map.pm.setLang(currentLang === "pt" ? "pt_br" : "en");
  applyTranslations();
  // applyTranslations() blindly re-applies each [data-i18n] element's EMPTY-state
  // string, which clobbers any live dynamic content. Re-render the dynamic metas
  // from state in the new language so loaded data / counts / picked points
  // survive a language toggle. (dem/vec/result metas drop their data-i18n on
  // write, so applyTranslations already leaves those alone.)
  if (typeof updateBridgeMeta === "function") updateBridgeMeta();
  if (typeof updateImpassableMeta === "function") updateImpassableMeta();
  if (typeof syncRefDisplay === "function") syncRefDisplay();
  if (typeof syncPointDisplays === "function") syncPointDisplays();
  // The cloud transfer line is set imperatively via t() (no data-i18n), so
  // re-render it after a language switch.
  if (typeof estimateRunTime === "function") estimateRunTime();
  // The layer-order panel builds its rows imperatively via t() only when
  // (re)opened — if it's currently open, rebuild it now so row labels,
  // aria-labels, and the GPX-upload tooltip follow the toggle without
  // requiring a close/reopen.
  if (refreshLayerOrderList && document.getElementById("layer-order-modal")?.classList.contains("active")) {
    refreshLayerOrderList();
  }
  if (refreshColormapLabels) refreshColormapLabels();
}

// Re-derive the src/dst point displays from state (density mode / src / dst), in
// the current language. Called on language toggle so picked coordinates and the
// correct prompt survive (applyTranslations would otherwise reset them).
function syncPointDisplays() {
  const srcDisp = document.getElementById("src-display");
  const dstDisp = document.getElementById("dst-display");
  if (!srcDisp || !dstDisp) return;
  if (document.getElementById("want-density")?.checked) {
    srcDisp.textContent = t("pts.density"); srcDisp.classList.remove("set");
    dstDisp.textContent = t("pts.density"); dstDisp.classList.remove("set");
    return;
  }
  if (state.src) { srcDisp.textContent = `r=${state.src[0]}, c=${state.src[1]}`; srcDisp.classList.add("set"); }
  else { srcDisp.textContent = t("pts.click_map"); srcDisp.classList.remove("set"); }
  if (state.dst) { dstDisp.textContent = `r=${state.dst[0]}, c=${state.dst[1]}`; dstDisp.classList.add("set"); }
  else { dstDisp.textContent = state.src ? t("pts.click_again") : t("pts.optional"); dstDisp.classList.remove("set"); }
}

// ---- Loaded-group highlight (style only — never affects compute) --------
// Lights up the whole "Load DEM" / "vector network" group while its data is
// present. There is no central state-change event in this app — DOM is
// driven off polled state — so this is called at every DEM/network load and
// clear site. `.toggle(..., bool)` makes the clear paths self-heal.
// Set exactly one status colour (or none) on a group's <details>/<summary>.
function setGroupStatus(id, status) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("st-green", "st-orange", "st-yellow", "st-red", "loaded");
  if (status) el.classList.add("st-" + status);
}

// Open/expand a collapsible group (and any ancestor <details>) so a nested
// group becomes visible. Used by the auto-expand hooks (DEM/network/mask/
// compute/bundle). Collapse state is not persisted — it follows these rules.
function setGroupOpen(id, open) {
  const el = document.getElementById(id);
  if (!el) return;
  el.open = !!open;
  if (open) {
    let p = el.parentElement;
    while (p) { if (p.tagName === "DETAILS") p.open = true; p = p.parentElement; }
  }
}

// Per-group status colours (style-only). Loaded inputs (1A-1D) go green when
// applied-to-compute, orange when loaded-but-not-applied. 3B/3C/4 reflect
// whether there are enough points, the run state, and a ready result.
function syncLoadedHighlights() {
  setGroupStatus("load-dem-group", state.dem ? "green" : "");
  const apply = (loaded, id) => loaded ? (document.getElementById(id)?.checked ? "green" : "orange") : "";
  setGroupStatus("network-group", apply(!!state.networkMask, "vec-constrain"));
  // 1C / 1D: drawn geometry counts as ready (green) on its own — even with no
  // loaded mask/network/bridge file (it's applied to the compute directly).
  const hasDrawnImp = !!((state.drawnImpassable && state.drawnImpassable.length) ||
                         (state.drawnPassable && state.drawnPassable.length));
  const hasDrawnPortals = !!(state.drawnPortals && state.drawnPortals.length);
  setGroupStatus("impassable-group", hasDrawnImp ? "green" : apply(!!state.impassable, "imp-enabled"));
  setGroupStatus("bridges-group", hasDrawnPortals ? "green" : apply(!!(state.bridges && state.bridges.length), "bridge-enabled"));

  // 3B — points & references: red = can't compute, orange = partial, green = complete.
  let pts = "";
  if (state.dem) {
    if (document.getElementById("want-density")?.checked) {
      const n = state.refPoints ? state.refPoints.length : 0;
      const target = Math.max(1, parseInt(document.getElementById("n-refs")?.value, 10) || 1);
      pts = n <= 0 ? "red" : (n >= target ? "green" : "orange");
    } else {
      pts = !state.src ? "red" : (state.dst ? "green" : "orange");
    }
  }
  setGroupStatus("pick-points-group", pts);

  // 3C — execution: orange running, green succeeded, yellow runnable-idle.
  const runBtnEl = document.getElementById("run");
  let exec = "";
  if (state.computeStartedAt) exec = "orange";
  else if (state.lastResult) exec = "green";
  else if (state.dem && runBtnEl && !runBtnEl.disabled) exec = "yellow";
  setGroupStatus("execution-group", exec);

  // 4 — results: orange if a result is ready.
  // 4 — results: orange while a compute is running, green once it finished.
  setGroupStatus("result-group", state.computeStartedAt ? "orange" : (state.lastResult ? "green" : ""));
}

// ---- Accessible names for standalone labels -----------------------------
// Most numeric/select fields are labelled by a sibling <label> with no `for`,
// so assistive tech reads them as unnamed. Associate each orphan label with
// the form control immediately after it (those controls all carry ids).
// Labels that WRAP their control (the checkbox rows) already name it — skip.
// Run once after the DOM is ready; the associations don't change with language.
function associateOrphanLabels() {
  document.querySelectorAll("label:not([for])").forEach((lab) => {
    if (lab.querySelector("input, select, textarea")) return; // wrapping label
    const ctrl = lab.nextElementSibling;
    if (ctrl && /^(INPUT|SELECT|TEXTAREA)$/.test(ctrl.tagName) && ctrl.id) {
      lab.htmlFor = ctrl.id;
    }
  });
}

// ---- Parameter persistence (remember choices across reloads) ------------
// Saves the parameter / network / visualization control values to
// localStorage and restores them on load, so the user's knob settings
// survive a page reload. Deliberately EXCLUDES session data (the loaded DEM,
// src/dst, reference points — those ride in bundles) and `max-workers`
// (already persisted separately as simu-max-workers).
const PERSIST_KEY = "simu-params";

// ── v2 leg-energy cost bundle ────────────────────────────────────────────────
// The compute engines (energy-worker.js v2Edge, graph-engine.js stepCost, the
// Rust backend v2_edge) are parameterised by this bundle, derived ONCE here from
// the physics inputs and shipped identically to all three so they stay
// bit-parity. See bicycling-energy-model/notas.md (v2). Coefficients are in
// kJ-based units (energy field / budget / legend stay kJ, as before α/β/η).
// epsOffset is the empirical −0.13 descent-recovery offset (a constant, not a
// UI knob) — originally fit on 44 rides, now cross-validated on 3 independent
// riders + the author's full export (bicycling-energy-model journal Entries
// 12/14/16). abRatio = crr + aeroCoef/mg is the dimensionless flat-resistance
// grade (= α/β) used by the per-grade descent recovery ε — deliberately
// UN-smoothed (it equals (aRoll+aAero)/beta only when kSmooth = 1; ε is a
// grade-geometry factor, not an energy one, so it must not scale with k_smooth).
// Flat reference speed v_f (m/s) from the rider's power on the flat: solve the
// steady wheel-power balance keff·P = (Crr·m·g + ½ρCdA·v²)·v by bisection.
// Mirrors bicycling-energy-model compare.mjs flatEqSpeed (wind = 0).
//
// GRAVITY — local, not textbook. 9.7864 m/s² is São Paulo's value from IAG-USP
// absolute gravimetry; 9.81 (the old constant) is ~0.24% high here. Every DEM
// this app ships and every ride the model was calibrated on sits in the SP
// metropolitan region, so the local value is the physical one. Re-baselined in
// v63 to re-sync with bicycling-energy-model (journal Entry 27), which moved
// first: while the two disagreed, the sibling applet's v2Edge readout differed
// from this app's by exactly the gravity ratio. Consequence: β (and every
// energy) falls by ≈0.24%.
// HAND-COPIED into census/census-density.mjs, test-energy-v2.mjs and
// docs/grid-*.mjs (the readCost mirror chain — grep 9.7864 to find them all).
// The Rust backend needs NO copy: it receives the derived {aRoll, aAero, beta,
// abRatio, …} bundle over the wire, so JS↔Rust bit-parity is gravity-blind.
const G_SP = 9.7864;
function flatEqSpeed(P, m, crr, cda, rho, keff) {
  const a = crr * m * G_SP, b = 0.5 * rho * cda;
  let lo = 0, hi = 40;
  for (let k = 0; k < 60; k++) {
    const v = (lo + hi) / 2;
    const wheel = (a + b * v * v) * v;
    if (wheel < keff * P) lo = v; else hi = v;
  }
  return (lo + hi) / 2;
}
function readCost() {
  const num = (id, dflt) => { const v = parseFloat(document.getElementById(id)?.value); return Number.isFinite(v) ? v : dflt; };
  const m    = Math.max(1, num("mass", 75));
  const crr  = Math.max(0, num("crr", 0.008));
  const cda  = Math.max(0, num("cda", 0.45));
  const rho  = Math.max(0, num("rho", 1.1));    // ~750 m asl (São Paulo)
  const keff = Math.min(1, Math.max(0.1, num("keff", 0.97)));
  const pFlat = Math.max(1, num("pflat", 80));  // W — rider power on the flat
  const vf   = flatEqSpeed(pFlat, m, crr, cda, rho, keff);  // m/s, derived
  const climbThr = Math.max(0, num("climb-thr", 2)) / 100;  // % → grade
  // k_smooth: profile-smoothing factor (notas v2). 1 = no smoothing (the per-edge
  // engine pays roller momentum implicitly; the notas' ≈0.74 is the FABDEM value
  // for the LOW-COMPUTE closed form). Multiplies the gravity term (climb + the
  // descent credit); ε stays computed from the UN-smoothed abRatio.
  const kSmooth = Math.min(1, Math.max(0, num("ksmooth", 1)));
  const g = G_SP, mg = m * g, KJ = 1000;   // local SP gravity — see G_SP above
  const aeroCoef = 0.5 * rho * cda * vf * vf;               // ½ρCdA·v_f² (J/ground-m, pre-/keff)
  return {
    aRoll: mg * crr / keff / KJ,
    aAero: aeroCoef / keff / KJ,
    beta: mg * kSmooth / keff / KJ,
    climbThr,
    abRatio: crr + aeroCoef / mg,   // un-smoothed flat-resistance grade (for ε); k_eff & kJ scale cancel
    epsOffset: 0.13,
  };
}
// The v2 analogue of v1's `alpha` (per-ground-metre distance cost) — used by the
// runtime estimator's reach model (flat reach ∝ eMax/alpha).
function costAlphaEquiv(c) { return c.aRoll + c.aAero; }
// Read-only readout of the derived v2 cost coefficients in the Parameters panel:
// α_r (rolling), α_a (flat aero), β (climb), already kJ/m. Live-updates on change.
function updateCostReadout() {
  const c = readCost();
  const fmt4 = (n) => (Number.isFinite(n) ? n.toFixed(4) : "—");
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("ro-alphar", fmt4(c.aRoll));
  set("ro-alphaa", fmt4(c.aAero));
  set("ro-beta", fmt4(c.beta));
}

const PERSIST_IDS = [
  // Parameters
  "mode", "mass", "crr", "cda", "rho", "keff", "pflat", "climb-thr", "ksmooth", "deadband", "dem-smooth", "e-max", "e-max-mode",
  "want-topn", "want-density",
  "n-refs", "ref-sampling", "refs-visible",
  "backend-url", "orchestrator-url", "cloud-keep-warm", "cloud-machine", "cloud-no-fallback", "n-routes", "penalty", "repulsion-mode",
  "routes-colormap", "colormap",
  // Vector network
  "vec-width", "vec-snap", "vec-constrain", "vec-graph-mode", "vec-junction-mode",
  "vec-compare", "vec-render", "vec-render-width", "vec-render-opacity",
  "net-interp", "net-interp-max-dist", "net-interp-smoothing",
  // Impassable mask (1C) + bridges (1D) — apply toggles, render + generation knobs
  "imp-enabled", "imp-show", "imp-opacity", "imp-rivers", "imp-corridor", "imp-offset",
  "impassable-invert",
  "bridge-enabled", "bridge-show", "bridge-opacity", "bridge-tunnels",
  // Visualization
  "basemap-select", "tile-visible", "tile-opacity", "relief-visible", "relief-opacity",
  "energy-visible", "energy-opacity", "energy-source", "vmin", "vmax",
  "passes-visible", "passes-opacity", "passes-vmin", "passes-vmax",
  "passes-gamma", "passes-mean-window", "passes-blend",
  "passes-vmin-b", "passes-vmax-b", "passes-gamma-b", "passes-mean-window-b",
];
// Restored controls whose change must re-fire dependent UI (sub-panel
// show/hide, basemap swap). We dispatch a synthetic change after restoring so
// the existing sync handlers reconcile the panel. Deliberately EXCLUDES the
// colormap selects — their change handler calls markStyleDirty(), which would
// flag a bogus "● refresh" on load; the legend is reconciled directly via the
// activeColormap assignment + applyColormapToLegend() call below instead.
const PERSIST_REFIRE = [
  "mode", "want-density", "want-topn", "basemap-select",
  "vec-graph-mode",
];
// The compute-source selector is a radiogroup (no single element to dispatch a
// change on), so its restore + UI reconcile is handled inline in
// setupParamPersistence via syncComputeSourceUI(). Persisted under this key.
const COMPUTE_SOURCE_KEY = "compute-source";
// Connection settings (possibly private LAN hostnames) — portable through the
// explicit, user-initiated Group-0 config export/import, but NOT through
// bundles: a shared bundle must not leak the exporter's backend/orchestrator
// URLs, and importing a bundle must not silently repoint the importer's
// session to attacker-supplied endpoints. Shared by collectConfig({forBundle})
// and applyConfig's persist:false (bundle) path so they can't drift apart.
const CONNECTION_PERSIST_IDS = ["backend-url", "orchestrator-url", "cloud-keep-warm", "cloud-machine", "cloud-no-fallback"];

function savePersistedParams() {
  const out = {};
  for (const id of PERSIST_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    out[id] = el.type === "checkbox" ? !!el.checked : el.value;
  }
  // The compute-source radiogroup persists as its checked value (not by id).
  out[COMPUTE_SOURCE_KEY] = computeMode();
  try { localStorage.setItem(PERSIST_KEY, JSON.stringify(out)); } catch {}
}

// Restore saved values, reconcile dependent UI, then wire change→save.
// Call LATE in init (after colormap selects are populated and the sub-panel
// sync handlers are wired) so dispatched changes find their listeners.
function setupParamPersistence() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(PERSIST_KEY) || "null"); } catch {}
  if (saved && typeof saved === "object") {
    for (const id of PERSIST_IDS) {
      if (!(id in saved)) continue;
      const el = document.getElementById(id);
      if (!el) continue;
      if (el.type === "checkbox") el.checked = !!saved[id];
      else {
        el.value = saved[id];
        if (id === "colormap" && COLORMAPS[saved[id]]) activeColormap = saved[id];
      }
    }
    for (const id of PERSIST_REFIRE) {
      document.getElementById(id)?.dispatchEvent(new Event("change"));
    }
    // Restore the compute-source selection. Prefer the new radiogroup key;
    // MIGRATE the old "use-backend" boolean: true → Localhost, false/absent →
    // Browser (Cloud is opt-in, never auto-selected on migration).
    let csVal = saved[COMPUTE_SOURCE_KEY];
    if (csVal == null && ("use-backend" in saved)) csVal = saved["use-backend"] ? "localhost" : "browser";
    if (csVal === "browser" || csVal === "localhost" || csVal === "cloud") {
      const radio = document.getElementById(
        csVal === "localhost" ? "cs-localhost" : csVal === "cloud" ? "cs-cloud" : "cs-browser");
      // Don't restore a disabled (non-local origin) Cloud radio — fall to Browser.
      if (radio && !radio.disabled) radio.checked = true;
    }
    applyColormapToLegend();
    applyLayerControls();
  }
  // Reconcile the compute-source sub-panels to whatever ended up selected
  // (always — even with no saved state, so the local-only gating note shows).
  syncComputeSourceUI();
  for (const id of PERSIST_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener("change", savePersistedParams);
    el.addEventListener("input", updateCostReadout);
  }
  updateCostReadout();
  // The radios live under name="compute-source", not in PERSIST_IDS — wire
  // their change to persist too.
  document.querySelectorAll('input[name="compute-source"]').forEach((el) => {
    el.addEventListener("change", savePersistedParams);
  });
}

// ------- Full config: export / import / reset (Group 0) -------
// One portable object capturing EVERY persisted control + the separately-stored
// bits (compute source, layer order, max-workers, language). Shared by the
// Group-0 buttons AND bundle embedding (buildMetadata/applyMetadataToUI).
// opts.forBundle (default false): strip connection settings (backend/
// orchestrator URL, cloud-keep-warm) and computeSource — bundles are shared
// artifacts and must not carry the exporter's (possibly private) endpoints.
// The explicit Group-0 export (forBundle unset) keeps full fidelity.
function collectConfig(opts = {}) {
  const forBundle = !!opts.forBundle;
  const params = {};
  for (const id of PERSIST_IDS) {
    if (forBundle && CONNECTION_PERSIST_IDS.includes(id)) continue;
    const el = document.getElementById(id);
    if (el) params[id] = el.type === "checkbox" ? !!el.checked : el.value;
  }
  let maxWorkers = "";
  try { maxWorkers = localStorage.getItem("simu-max-workers") || ""; } catch {}
  return {
    kind: "simujoules-config",
    version: 1,
    params,
    computeSource: forBundle ? undefined : computeMode(),
    layerOrder: layerOrder.slice(),
    maxWorkers,
    lang: currentLang,
    // On-map drawn geometry (1C barriers/corridors as lat/lng rings, 1D portals
    // as lat/lng polylines) so it round-trips through config + bundles.
    drawn: {
      impassable: state.drawnImpassable || [],
      passable: state.drawnPassable || [],
      portals: (state.drawnPortals || []).map((p) => ({ latlngs: p.latlngs })),
    },
  };
}

// Apply a config object (from import or a bundle). Tolerates a flat params map.
// Returns true on success. Mirrors setupParamPersistence's restore path.
// opts.persist (default true): write the applied state back to localStorage and
// adopt the config's language. A BUNDLE load passes persist:false — it applies
// the params to the live session UI but must NOT clobber the user's saved
// language / params / layer order / max-workers on disk.
function applyConfig(cfg, opts = {}) {
  if (!cfg || typeof cfg !== "object") return false;
  const persist = opts.persist !== false;
  const params = (cfg.params && typeof cfg.params === "object") ? cfg.params : cfg;
  for (const id of PERSIST_IDS) {
    // Bundles (persist:false) must never repoint the session's connection
    // settings — defence in depth even against a bundle whose writer forgot
    // to strip them (or an old/crafted bundle that still carries them).
    if (!persist && CONNECTION_PERSIST_IDS.includes(id)) continue;
    if (!(id in params)) continue;
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = !!params[id];
    else {
      el.value = params[id];
      if (id === "colormap" && COLORMAPS[params[id]]) activeColormap = params[id];
    }
  }
  for (const id of PERSIST_REFIRE) document.getElementById(id)?.dispatchEvent(new Event("change"));
  // Same defence for the compute-source radiogroup — a bundle must not
  // silently select Localhost/Cloud for the importer.
  const cs = persist ? cfg.computeSource : null;
  if (cs === "browser" || cs === "localhost" || cs === "cloud") {
    const radio = document.getElementById(
      cs === "localhost" ? "cs-localhost" : cs === "cloud" ? "cs-cloud" : "cs-browser");
    if (radio && !radio.disabled) radio.checked = true;
  }
  syncComputeSourceUI();
  if (Array.isArray(cfg.layerOrder) && cfg.layerOrder.length) {
    const valid = cfg.layerOrder.filter((k) => DEFAULT_LAYER_ORDER.includes(k));
    layerOrder = valid.concat(DEFAULT_LAYER_ORDER.filter((k) => !valid.includes(k)));
    if (persist) try { localStorage.setItem("simu-layer-order", JSON.stringify(layerOrder)); } catch {}
    applyLayerOrder();
  }
  if (cfg.maxWorkers != null) {
    const mw = document.getElementById("max-workers");
    if (mw) mw.value = cfg.maxWorkers;
    if (persist) try { localStorage.setItem("simu-max-workers", String(cfg.maxWorkers)); } catch {}
  }
  // Adopt the config's language only on an explicit import — a bundle must not
  // flip the user's UI language (setLang persists it).
  if (persist && (cfg.lang === "en" || cfg.lang === "pt")) setLang(cfg.lang);
  // Restore on-map drawn geometry (overlays + masks + portal bridges).
  if (cfg.drawn && typeof cfg.drawn === "object") {
    state.drawnImpassable = Array.isArray(cfg.drawn.impassable) ? cfg.drawn.impassable : [];
    state.drawnPassable = Array.isArray(cfg.drawn.passable) ? cfg.drawn.passable : [];
    state.drawnPortals = Array.isArray(cfg.drawn.portals) ? cfg.drawn.portals : [];
    if (typeof restoreDrawnGeometry === "function") restoreDrawnGeometry();
    // The grid changed — drop any stale rendered result so it doesn't linger
    // inconsistent with the restored barriers/corridors/portals. (In the bundle
    // path the bundle's own result is rendered immediately after, overwriting.)
    const hasDrawn = (state.drawnImpassable.length || state.drawnPassable.length || state.drawnPortals.length);
    if (hasDrawn) { markImpassableDirty(true); markBridgesDirty(true); }
  }
  applyColormapToLegend();
  applyLayerControls();
  if (persist) savePersistedParams();
  return true;
}

// Wire the Group-0 export/import/reset buttons. Called from init.
function setupConfigButtons() {
  document.getElementById("config-export")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(collectConfig(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "simujoules-config.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  document.getElementById("config-import-btn")?.addEventListener("click", () => {
    document.getElementById("config-file")?.click();
  });
  document.getElementById("config-file")?.addEventListener("change", (ev) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const cfg = JSON.parse(reader.result);
        if (applyConfig(cfg)) status.textContent = t("config.imported");
        else status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(t("config.import_error"))}</span>`;
      } catch (e) {
        status.innerHTML = `<span style="color:#ff6b6b">${t("config.import_error")}: ${escapeHtml(e.message)}</span>`;
      }
    };
    reader.readAsText(f);
  });
  document.getElementById("config-reset")?.addEventListener("click", () => {
    if (!window.confirm(t("config.reset_confirm"))) return;
    for (const k of ["simu-params", "simu-layer-order", "simu-max-workers", "simu-lang", "simu-sidebar-cols"]) {
      try { localStorage.removeItem(k); } catch {}
    }
    location.reload();
  });
}

// ------- Compute workers -------
// All compute runs in energy-worker.js instances: one worker for regular
// runs, a pool of them for multi-reference density (each ref's Dijkstra is
// independent — see the density pool in the Compute handler). An optional
// native Rust backend (backend/ in the repo, OFF by default) can take over
// density runs; everything else always stays in-browser.
const WORKER_URL = "./energy-worker.js";

// ------- Map setup -------
// "Refresh style" dirty bookkeeping.
//
// Why a snapshot rather than a plain dirty flag: in some browsers the
// blur-fired `change` event on a focused input fires AFTER a click event
// on a different element. With a plain flag, that ordering re-marks the
// state dirty *after* the Refresh handler cleared it, leading to the
// "needs a second click" symptom. With a snapshot, markStyleDirty
// compares current values against what was last rendered — if nothing
// actually differs it stays clean, regardless of event ordering.
function styleSnapshot() {
  return JSON.stringify({
    cm:  activeColormap,
    rcm: document.getElementById("routes-colormap")?.value || "",
    vm:  document.getElementById("vmin")?.value || "",
    vM:  document.getElementById("vmax")?.value || "",
    pvm: document.getElementById("passes-vmin")?.value || "",
    pvM: document.getElementById("passes-vmax")?.value || "",
    g:   document.getElementById("passes-gamma")?.value || "",
    w:   document.getElementById("passes-mean-window")?.value || "",
    b:   document.getElementById("passes-blend")?.value || "",
    pbm: document.getElementById("passes-vmin-b")?.value || "",
    pbM: document.getElementById("passes-vmax-b")?.value || "",
    gb:  document.getElementById("passes-gamma-b")?.value || "",
    wb:  document.getElementById("passes-mean-window-b")?.value || "",
  });
}
function markStyleDirty() {
  // Skip if nothing actually changed since the last render — guards
  // against late blur/change events re-marking after a refresh click.
  if (state.lastStyleSnapshot === styleSnapshot()) return;
  const btn = document.getElementById("refresh-style");
  if (btn) {
    btn.dataset.dirty = "1";
    btn.textContent = `${t("btn.refresh_style")} ●`;
  }
}
function clearStyleDirty() {
  state.lastStyleSnapshot = styleSnapshot();
  const btn = document.getElementById("refresh-style");
  if (btn) {
    btn.dataset.dirty = "";
    btn.textContent = t("btn.refresh_style");
  }
}

// (Engine-tag pill removed — JS is the only compute engine now.)

// Wire the colormap selector and the manual range inputs. Any change
// re-renders the cached energy field — no recompute needed.
document.addEventListener("DOMContentLoaded", () => {
  // Apply translations as soon as the DOM is ready, BEFORE any other UI
  // wiring that might read element text. This populates static labels,
  // option text in select elements, etc.
  applyTranslations();
  // Give every standalone field label an accessible association (for=…).
  associateOrphanLabels();
  // Language toggle pill — flips PT ↔ EN, persists to localStorage.
  const langPill = document.getElementById("lang-tag");
  if (langPill) {
    langPill.addEventListener("click", () => {
      setLang(currentLang === "pt" ? "en" : "pt");
    });
  }
  // Populate the colormap dropdown with all CET maps, grouped by class.
  const sel = document.getElementById("colormap");
  if (sel) {
    rebuildColormapOptions(sel);
    sel.value = activeColormap;
    // Live-update the swatch (cheap CSS) but DEFER the canvas re-render to
    // the explicit Refresh-style button — re-rendering on every keystroke
    // gets laggy on large DEMs.
    sel.addEventListener("change", () => {
      activeColormap = sel.value;
      applyColormapToLegend();
      markStyleDirty();
    });
  }
  // Numeric range / gamma / mean-window inputs only mark "dirty"; the
  // canvas redraws on Refresh-style click.
  for (const id of [
    "vmin", "vmax",
    "passes-vmin", "passes-vmax",
    "passes-gamma", "passes-mean-window",
    "passes-vmin-b", "passes-vmax-b",
    "passes-gamma-b", "passes-mean-window-b",
    "passes-blend",
  ]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener("input", markStyleDirty);
    el.addEventListener("change", markStyleDirty);
  }
  // Refresh-style commits whatever's marked dirty. We force-blur any
  // focused input first so the input's blur-fired `change` event (which
  // calls markStyleDirty) runs BEFORE we render+clear, not after — that
  // ordering quirk previously left the dirty bullet on after a single
  // click and made it look like a second click was needed.
  const refreshBtn = document.getElementById("refresh-style");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
      rerenderCachedResult();
      clearStyleDirty();
    });
  }
  const reset = document.getElementById("range-reset");
  if (reset) {
    reset.addEventListener("click", () => {
      for (const id of ["vmin", "vmax", "passes-vmin", "passes-vmax"]) {
        const el = document.getElementById(id);
        if (el) el.value = "";
      }
      rerenderCachedResult();
      clearStyleDirty();
    });
  }
  // Per-layer visibility / opacity controls — pure live updates (no
  // canvas re-render).
  for (const id of [
    "tile-visible",   "tile-opacity",
    "relief-visible", "relief-opacity",
    "energy-visible", "energy-opacity",
    "passes-visible", "passes-opacity",
    "refs-visible",
  ]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener("input", applyLayerControls);
    el.addEventListener("change", applyLayerControls);
  }
  // (Passes blend mode used to fire its own re-render here; that path
  // is now folded into the Refresh-style button along with all the
  // other heavy controls. The dirty-marker loop above already wires
  // passes-blend to markStyleDirty, so changes show up on next refresh.)
  // Routes-colormap selector — populate from CET maps and re-draw routes
  // (without recomputing) on change.
  const routesSel = document.getElementById("routes-colormap");
  if (routesSel) {
    rebuildColormapOptions(routesSel);
    routesSel.value = "CET_R2"; // perceptually uniform rainbow — good for ranks
    // Recolour only the route polylines — no full raster re-render of the
    // energy/passes canvases (which the field-colormap inputs defer behind
    // the Refresh-style button anyway).
    routesSel.addEventListener("change", recolorRouteLines);
  }
  refreshColormapLabels = () => {
    if (sel) rebuildColormapOptions(sel);
    if (routesSel) rebuildColormapOptions(routesSel);
  };
  // Top-N toggle reveals N + penalty + repulsion inputs
  const topnCheck = document.getElementById("want-topn");
  // Maximise toggle reveals the L-length input. Sync once on load so the
  // panel state matches the checkbox after a bundle reload too. #maximize
  // has had no UI control since v36 (engine + backend still support the
  // mode; only the toggle was pulled) — this stays dormant (maxCheck null,
  // guarded below) until/unless the control is restored.
  const maxCheck = document.getElementById("maximize");
  const maxExtra = document.getElementById("maximize-extra");
  if (maxCheck && maxExtra) {
    const sync = () => {
      maxExtra.style.display = maxCheck.checked ? "" : "none";
      // The energy budget (real kJ) has no meaning against maximize's
      // INVERTED costs (maxEdgeCost units) — the run ignores it, so grey
      // the input out and say why in its tooltip (via data-i18n-title so a
      // language toggle keeps the right text).
      const eMaxInput = document.getElementById("e-max");
      if (eMaxInput) {
        eMaxInput.disabled = maxCheck.checked;
        eMaxInput.dataset.i18nTitle = maxCheck.checked ? "param.budget.maximize_title" : "param.budget.title";
        eMaxInput.title = t(eMaxInput.dataset.i18nTitle);
      }
      estimateRunTime();
    };
    maxCheck.addEventListener("change", sync);
    sync();
  }
  const topnExtra = document.getElementById("topn-extra");
  if (topnCheck && topnExtra) {
    const sync = () => { topnExtra.style.display = topnCheck.checked ? "" : "none"; estimateRunTime(); };
    topnCheck.addEventListener("change", sync);
    sync();
  }
  // Budget-mode select is only meaningful in round-trip mode (a single leg
  // IS the total in from/to) — hide it elsewhere.
  const modeSel = document.getElementById("mode");
  const budgetModeRow = document.getElementById("e-max-mode-row");
  if (modeSel && budgetModeRow) {
    const syncBudgetMode = () => {
      budgetModeRow.style.display = modeSel.value === "round" ? "" : "none";
    };
    modeSel.addEventListener("change", syncBudgetMode);
    syncBudgetMode();
  }
  // Basemap selector — swaps the base tile layer / solid background.
  const basemapSel = document.getElementById("basemap-select");
  if (basemapSel) {
    basemapSel.addEventListener("change", () => applyBasemap(basemapSel.value));
  }
  // Vector-network rendering toggle — pure overlay add/remove, no recompute.
  document.getElementById("vec-render")?.addEventListener("change", applyNetworkLinesOverlay);
  // Width/opacity restyle the existing polylines in place (live).
  for (const id of ["vec-render-width", "vec-render-opacity"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener("input", updateNetworkLineStyle);
    el.addEventListener("change", updateNetworkLineStyle);
  }
  // Compute-source selector (Browser / Localhost / Cloud — a top-level compute
  // option). Each radio's change reconciles the sub-panels (Localhost URL /
  // Cloud orchestrator) and gates Cloud to local origins. Browser is the
  // default and the always-available fallback. syncComputeSourceUI also runs in
  // setupParamPersistence after the persisted selection is restored.
  document.querySelectorAll('input[name="compute-source"]').forEach((el) => {
    el.addEventListener("change", syncComputeSourceUI);
  });
  syncComputeSourceUI();
  // Persist the advanced max-workers override per device (like the lang /
  // layer-order prefs) — power users on big-RAM machines set it once.
  const maxWorkersEl = document.getElementById("max-workers");
  if (maxWorkersEl) {
    try { const v = localStorage.getItem("simu-max-workers"); if (v != null) maxWorkersEl.value = v; } catch {}
    maxWorkersEl.addEventListener("change", () => {
      try { localStorage.setItem("simu-max-workers", maxWorkersEl.value); } catch {}
    });
  }
  // Density toggle reveals the multi-ref controls and locks out the
  // single-source top-N toggle, which doesn't compose with multi-reference
  // density. (Passes are always computed since v68 — no toggle to lock.)
  const densCheck = document.getElementById("want-density");
  const densExtra = document.getElementById("density-extra");
  if (densCheck && densExtra) {
    const sync = () => {
      const on = densCheck.checked;
      densExtra.style.display = on ? "" : "none";
      if (on) setGroupOpen("pick-points-group", true); // surface the census/refs panel

      const topnCheck = document.getElementById("want-topn");
      const topnLabel = topnCheck?.closest("label");
      const topnExtra = document.getElementById("topn-extra");
      if (topnCheck) {
        if (on) { topnCheck.checked = false; topnCheck.disabled = true; }
        else topnCheck.disabled = false;
      }
      if (topnLabel) topnLabel.style.opacity = on ? "0.5" : "1";
      if (on && topnExtra) topnExtra.style.display = "none";

      // Drop any source/destination state when entering density mode —
      // it's not used and the leftover markers / UI labels are confusing.
      // Fade ONLY the src/dst picker (references replace it); the reference-
      // action buttons clustered below it must stay live in density mode.
      const srcdst = document.getElementById("pick-points-srcdst");
      if (srcdst) {
        srcdst.style.opacity = on ? "0.45" : "1";
        srcdst.style.pointerEvents = on ? "none" : "";
      }
      // The "Place random" / "Clear refs" cluster only applies in density mode.
      const refActions = document.getElementById("ref-actions-row");
      if (refActions) refActions.style.display = on ? "" : "none";
      if (on) {
        state.src = null;
        state.dst = null;
        if (state.srcMarker) { state.srcMarker.remove(); state.srcMarker = null; }
        if (state.dstMarker) { state.dstMarker.remove(); state.dstMarker = null; }
        if (state.pathLine)  { state.pathLine.remove();  state.pathLine = null; }
        const srcDisp = document.getElementById("src-display");
        const dstDisp = document.getElementById("dst-display");
        if (srcDisp) { srcDisp.textContent = t("pts.density"); srcDisp.classList.remove("set"); }
        if (dstDisp) { dstDisp.textContent = t("pts.density"); dstDisp.classList.remove("set"); }
      } else {
        const srcDisp = document.getElementById("src-display");
        const dstDisp = document.getElementById("dst-display");
        if (srcDisp && !state.src) srcDisp.textContent = t("pts.click_map");
        if (dstDisp && !state.dst) dstDisp.textContent = t("pts.optional");
      }

      // Energy layer stays available in density mode — when refs > 0 the
      // worker returns the per-cell mean energy across all refs, so the
      // user can read the average as well as the density.
      applyLayerControls();
      // Re-render any cached result (so a leftover energy overlay clears).
      rerenderCachedResult();

      // Compute button gate flips between src-required and refs-required.
      updateRunButtonState();
      estimateRunTime();
    };
    densCheck.addEventListener("change", sync);
    sync();
  }
  document.getElementById("ref-place-random")?.addEventListener("click", () => {
    const n = parseInt(document.getElementById("n-refs")?.value, 10) || 10;
    placeRandomRefPoints(n);
  });
  document.getElementById("ref-clear")?.addEventListener("click", clearRefPoints);
  document.getElementById("ref-file")?.addEventListener("change", async (ev) => {
    const f = ev.target.files[0];
    if (f) await loadRefPointsFromFile(f);
    ev.target.value = "";   // let the same file be re-loaded
  });
  document.getElementById("ref-export")?.addEventListener("click", exportRefPoints);
  // Anything that affects the time estimate
  // Inputs that move the (now budget- and engine-aware) time estimate.
  // `alpha` scales the explored region (flat reach ∝ eMax/alpha); the
  // compute-source selector switches the engine model (handled below with the
  // radios, since they share a name rather than a single id).
  for (const id of ["mode", "want-topn", "n-routes", "want-density",
                    "n-refs", "e-max", "mass", "crr", "cda", "rho", "keff", "pflat", "ksmooth", "max-workers",
                    // Network/graph + interpolation controls — they move the
                    // estimate now that interp is a separate phase and graph
                    // mode has its own (much cheaper) compute model.
                    "net-interp", "net-interp-max-dist", "net-interp-smoothing",
                    "vec-graph-mode", "vec-constrain", "vec-compare"]) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", estimateRunTime);
  }
  // Graph mode supersedes the raster constrain/compare toggles in the run
  // dispatch — grey them out when it's on so the precedence is visible. Fires
  // on toggle AND on load (vec-graph-mode is in PERSIST_REFIRE → synthetic
  // change after restore). See syncGraphModeUI.
  document.getElementById("vec-graph-mode")?.addEventListener("change", syncGraphModeUI);
  syncGraphModeUI();
  // Compute-source / URL changes refresh the cached /health core count (used by
  // the estimate's backend-parallelism model) AND re-estimate (engine model +
  // transfer line). The radios share name="compute-source"; the two URL fields
  // (backend / orchestrator) feed the same /health probe via effectiveBackendUrl.
  const onComputeSourceChange = () => { refreshBackendCores(); estimateRunTime(); };
  document.querySelectorAll('input[name="compute-source"]').forEach((el) => {
    el.addEventListener("change", onComputeSourceChange);
  });
  for (const id of ["backend-url", "orchestrator-url"]) {
    const el = document.getElementById(id);
    if (el) { el.addEventListener("change", onComputeSourceChange); el.addEventListener("input", estimateRunTime); }
  }
  // Cloud machine size: the estimate models the SELECTED size directly
  // (backendSpecForEstimate) — re-estimate on change, no /health probe needed.
  document.getElementById("cloud-machine")?.addEventListener("change", estimateRunTime);
  // "Desligar VM agora": manual stop, so a size change applies without the
  // untick-keep-warm-run-retick dance (a lease from a concurrent client still
  // vetoes the stop orchestrator-side). Best-effort like the post-run stop.
  document.getElementById("cloud-stop-now")?.addEventListener("click", () => {
    const url = computeMode() === "cloud" ? effectiveBackendUrl() : "";
    if (!url || !cloudToken()) { setCloudHint("cloud.need_orch_url"); return; }
    stopCloudVm(url);
    setCloudHint("cloud.stopping_manual");
  });
  // Cloud password: persisted in sessionStorage (a secret — NOT localStorage,
  // where the URL fields live). Restore on load, save on input.
  {
    const tokEl = document.getElementById("cloud-token");
    if (tokEl) {
      try { tokEl.value = sessionStorage.getItem("cloud-token") || ""; } catch { /* private mode */ }
      tokEl.addEventListener("input", () => {
        try { sessionStorage.setItem("cloud-token", tokEl.value); } catch { /* private mode */ }
      });
    }
  }
  // Example DEM loader links — populated declaratively in HTML, wired here.
  for (const ex of DEM_EXAMPLES) {
    const a = document.getElementById(ex.id);
    if (!a) continue;
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      loadDemFromUrl(ex.url, ex.label);
    });
  }
  // FABDEM-for-current-viewport. Sized at click time from map.getBounds()
  // so the user can zoom around before clicking; capped at 50 MB inside
  // loadFabdemForView().
  const fabBtn = document.getElementById("ex-fabdem-view");
  if (fabBtn) {
    fabBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      loadFabdemForView();
    });
  }
  // Crop the loaded DEM to the current viewport (1A) — export→reimport of
  // the window through the standard load path; see cropDemToViewport().
  document.getElementById("crop-dem")?.addEventListener("click", cropDemToViewport);
  // Downsample the loaded DEM by block averaging (1A); factor from the select.
  document.getElementById("downsample-dem")?.addEventListener("click", () => {
    const f = parseInt(document.getElementById("dem-downsample-factor")?.value, 10) || 6;
    downsampleDem(f);
  });
  // Locate-me floating button. Lives on the map (not in the drawer),
  // so it's reachable on mobile without opening the controls panel.
  document.getElementById("locate-btn")?.addEventListener("click", centerOnUserLocation);
  // Vector-network upload + clear.
  const vecFile = document.getElementById("vector-file");
  if (vecFile) {
    vecFile.addEventListener("change", async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      try {
        await loadVectorNetwork(f);
      } catch (err) {
        console.error(err);
        progress.classList.remove("active");
        status.innerHTML = `<span style="color:#ff6b6b">${t("status.gpkg_failed", escapeHtml(err.message))}</span>`;
      }
      // Reset the input so re-picking the same file fires `change` again.
      ev.target.value = "";
    });
  }
  const vecClearBtn = document.getElementById("vec-clear");
  if (vecClearBtn) vecClearBtn.addEventListener("click", clearVectorNetwork);
  document.getElementById("vec-osm")?.addEventListener("click", loadOsmNetwork);
  document.getElementById("vec-fgb")?.addEventListener("click", loadFgbNetwork);
  document.getElementById("ex-viario")?.addEventListener("click", () =>
    loadVectorFromUrl("https://simujaules.pedalhidrografi.co/vector/sampa-viario.gpkg", t("net.example_viario")));

  // --- Impassable mask (group 1c) ---
  const impFile = document.getElementById("impassable-file");
  if (impFile) {
    impFile.addEventListener("change", async (ev) => {
      const f = ev.target.files[0];
      if (f) await loadImpassableMaskFromFile(f);
      ev.target.value = ""; // re-picking the same file fires change again
    });
  }
  document.getElementById("impassable-clear")?.addEventListener("click", clearImpassableMask);
  document.getElementById("impassable-osm")?.addEventListener("click", loadOsmWater);
  document.getElementById("impassable-fgb")?.addEventListener("click", loadFgbWater);
  document.getElementById("ex-water")?.addEventListener("click", () =>
    loadImpassableFromUrl("https://simujaules.pedalhidrografi.co/mask/water_mask.tif", t("imp.example_water")));
  document.getElementById("imp-rivers")?.addEventListener("change", async () => { await rebuildOsmWaterMask(); });
  document.getElementById("imp-enabled")?.addEventListener("change", () => markImpassableDirty(true));
  // 1B "Aplicar ao cálculo" toggle updates its green/orange status.
  document.getElementById("vec-constrain")?.addEventListener("change", syncLoadedHighlights);
  document.getElementById("impassable-invert")?.addEventListener("change", () => {
    // Re-resample the cached source with the flipped convention (no re-upload).
    if (state.impassableRaster) applyImpassableRaster(state.impassableRaster, state.impassableMeta?.name);
  });
  document.getElementById("imp-corridor")?.addEventListener("change", (ev) => {
    const row = document.getElementById("imp-offset-row");
    if (row) row.style.display = ev.target.checked ? "" : "none";
    recomputeCorridors();   // corridors appear/disappear → geometry change
    updateImpassableMeta();
    markImpassableDirty(true);
  });
  document.getElementById("imp-offset")?.addEventListener("change", () => {
    // Offset shifts corridor heights only (geometry unchanged) → no reprobe;
    // buildComputeGrid re-applies the offset to the cached corridor base/ramp.
    markImpassableDirty(false);
  });
  document.getElementById("imp-show")?.addEventListener("change", (ev) => {
    const row = document.getElementById("imp-opacity-row");
    if (row) row.style.display = ev.target.checked ? "" : "none";
    applyImpassableOverlay();
  });
  document.getElementById("imp-opacity")?.addEventListener("input", () => {
    if (state.impassableOverlay) state.impassableOverlay.setOpacity(impassableOverlayOpacity());
  });

  // --- Bridges & tunnels (group 1d) ---
  document.getElementById("bridge-osm")?.addEventListener("click", loadOsmBridges);
  document.getElementById("bridge-fgb")?.addEventListener("click", loadFgbBridges);
  document.getElementById("bridge-from-network")?.addEventListener("click", () => {
    const c = state.networkBridgeCandidates;
    if (!c || !c.length) { status.innerHTML = `<span style="color:#ff6b6b">${t("bridge.no_candidates")}</span>`; return; }
    const withTunnels = !!document.getElementById("bridge-tunnels")?.checked;
    const ways = withTunnels ? c : c.filter((w) => w.kind !== "tunnel");
    installBridgesFromWays(ways, "network");
  });
  document.getElementById("bridge-clear")?.addEventListener("click", clearBridges);
  document.getElementById("bridge-enabled")?.addEventListener("change", () => markBridgesDirty(true));
  document.getElementById("bridge-show")?.addEventListener("change", (ev) => {
    const row = document.getElementById("bridge-opacity-row");
    if (row) row.style.display = ev.target.checked ? "" : "none";
    applyBridgeOverlay();
  });
  document.getElementById("bridge-opacity")?.addEventListener("input", () => {
    // In-place opacity — don't rebuild every polyline on each slider tick.
    if (state.bridgesLayer) state.bridgesLayer.eachLayer((l) => l.setStyle({ opacity: bridgeOverlayOpacity() }));
  });
  // Switching the displayed energy field (constrained / unconstrained /
  // difference) re-renders cached arrays — never recomputes.
  document.getElementById("energy-source")?.addEventListener("change", () => {
    rerenderCachedResult();
    clearStyleDirty();
  });

  // Bundle download / reload
  const dlBtn = document.getElementById("download-bundle");
  if (dlBtn) dlBtn.addEventListener("click", downloadBundle);
  const exportImgBtn = document.getElementById("export-rendered");
  if (exportImgBtn) exportImgBtn.addEventListener("click", exportRenderedImages);
  const reloadInput = document.getElementById("bundle-file");
  if (reloadInput) {
    reloadInput.addEventListener("change", (ev) => {
      const f = ev.target.files[0];
      if (f) loadBundleFile(f);
      // Reset the input so the same filename re-triggers `change` if picked again.
      ev.target.value = "";
    });
  }

  // Group 0 input-dataset export/import. Exports are one-click; imports open a
  // hidden file input and route to the matching loader (same loaders the 1A–1D
  // groups use), so import accepts exactly what export produces.
  document.getElementById("export-dem")?.addEventListener("click", exportDemTif);
  document.getElementById("export-network")?.addEventListener("click", exportNetworkGpkg);
  document.getElementById("export-mask")?.addEventListener("click", exportMaskTif);
  document.getElementById("export-bridges")?.addEventListener("click", exportBridgesGpkg);
  const wireImport = (btnId, inputId, loader) => {
    document.getElementById(btnId)?.addEventListener("click", () => document.getElementById(inputId)?.click());
    document.getElementById(inputId)?.addEventListener("change", async (ev) => {
      const f = ev.target.files[0];
      ev.target.value = ""; // re-picking the same file fires change again
      if (!f) return;
      try { await loader(f); }
      catch (err) { console.error(err); status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(err.message)}</span>`; }
    });
  };
  wireImport("import-dem", "io-dem-file", async (f) => {
    const gen = ++state.demLoadGen;
    const buf = await f.arrayBuffer();
    if (gen !== state.demLoadGen) return; // a newer DEM load started while we were reading — last click wins
    state.demSourceUrl = null;
    await loadDemFromArrayBuffer(buf, f.name, gen);
  });
  wireImport("import-network", "io-network-file", (f) => loadVectorNetwork(f));
  wireImport("import-mask", "io-mask-file", (f) => loadImpassableMaskFromFile(f));
  wireImport("import-bridges", "io-bridges-file", (f) => importBridgesGpkg(f));

  // Reference-geometry GPX picker (triggered by the layer row's ↑ upload button).
  document.getElementById("refgeom-file")?.addEventListener("change", async (ev) => {
    const f = ev.target.files[0];
    ev.target.value = ""; // re-picking the same file fires change again
    if (f) await loadRefGeometry(f);
  });

  applyColormapToLegend();
  // Apply initial layer controls so the rmsampa-v2 tile layer (default ON)
  // gets added to the map without waiting for a Compute.
  applyLayerControls();

  // Help modal: open via the "?" button, close via × / backdrop click /
  // Escape key. Body scroll-lock isn't needed since the panel doesn't
  // scroll behind the modal.
  const helpBtn = document.getElementById("help-btn");
  const helpModal = document.getElementById("help-modal");
  const helpClose = document.getElementById("help-close");
  const openHelp  = () => helpModal?.classList.add("active");
  const closeHelp = () => helpModal?.classList.remove("active");
  helpBtn?.addEventListener("click", openHelp);
  helpClose?.addEventListener("click", closeHelp);
  helpModal?.addEventListener("click", (e) => {
    // Click on the backdrop (not on the modal body itself) closes.
    if (e.target === helpModal) closeHelp();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && helpModal?.classList.contains("active")) closeHelp();
  });

  // Layer-stacking-order modal: list rendered top-of-screen-first, rows
  // moved with ↑/↓, applied immediately to the pane z-indices and
  // persisted. Rebuilt on every open so labels follow the language toggle.
  const orderModal = document.getElementById("layer-order-modal");
  const orderList = document.getElementById("layer-order-list");
  // Per-layer visibility/opacity input ids the modal rows PROXY (the real
  // inputs live in a hidden store, or in groups 1B/1C for network/impassable).
  // Every proxied input already has its own input+change listener that applies
  // the change, so the proxy just mirrors the value and dispatches those events.
  const LAYER_VIS = {
    relief:     { vis: "relief-visible",  op: "relief-opacity"  },
    impassable: { vis: "imp-show",        op: "imp-opacity"     },
    energy:     { vis: "energy-visible",  op: "energy-opacity"  },
    network:    { vis: "vec-render",      op: "vec-render-opacity" },
    passes:     { vis: "passes-visible",  op: "passes-opacity"  },
    refgeom:    { vis: "refgeom-visible", op: null, upload: true },
    routes:     { vis: null,              op: null              },
  };
  // Fixed (non-reorderable) layers shown after the stacking list.
  const FIXED_ROWS = [
    { labelKey: "layer.tiles",      vis: "tile-visible",   op: "tile-opacity" },
    { labelKey: "layer.bridges",    vis: "bridge-show",    op: "bridge-opacity" },
    { labelKey: "ref.show_markers", vis: "refs-visible",   op: null },
  ];
  const fireInput = (el) => {
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const buildLayerRow = ({ labelKey, reorder, vis, op, upload }) => {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;align-items:center;gap:6px;padding:4px 6px;" +
      "border:1px solid var(--border);border-radius:4px;margin-top:4px;";
    // Ordering arrows on the LEFT (or a same-width spacer for fixed rows).
    const arrows = document.createElement("div");
    arrows.style.cssText = "display:flex;gap:2px;flex:none;width:50px;";
    if (reorder) {
      const mkBtn = (label, disabled, delta) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "secondary"; b.textContent = label;
        b.disabled = disabled; b.style.cssText = "width:24px;height:24px;padding:2px 0;margin:0;";
        b.setAttribute("aria-label", t(delta > 0 ? "order.move_up" : "order.move_down") + " — " + t(labelKey));
        b.addEventListener("click", () => {
          // Visually "up" = drawn on top = later in the bottom→top layerOrder.
          const i = layerOrder.indexOf(reorder.key);
          const j = i + delta;
          if (j < 0 || j >= layerOrder.length) return;
          [layerOrder[i], layerOrder[j]] = [layerOrder[j], layerOrder[i]];
          applyLayerOrder();
          renderOrderList();
        });
        return b;
      };
      arrows.appendChild(mkBtn("↑", reorder.di === 0, +1));
      arrows.appendChild(mkBtn("↓", reorder.di === reorder.last, -1));
    }
    row.appendChild(arrows);
    // Visibility checkbox (proxies the real input).
    const realVis = vis ? document.getElementById(vis) : null;
    if (realVis) {
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.style.flex = "none"; cb.setAttribute("aria-label", t(labelKey));
      cb.checked = realVis.checked;
      cb.addEventListener("change", () => { realVis.checked = cb.checked; fireInput(realVis); });
      row.appendChild(cb);
    } else {
      const sp = document.createElement("span"); sp.style.cssText = "width:13px;flex:none;";
      row.appendChild(sp);
    }
    // Name.
    const name = document.createElement("span");
    name.style.cssText = "flex:1;font-size:12px;"; name.textContent = t(labelKey);
    row.appendChild(name);
    // Opacity slider (proxies the real input).
    const realOp = op ? document.getElementById(op) : null;
    if (realOp) {
      const r = document.createElement("input");
      r.type = "range"; r.min = "0"; r.max = "1"; r.step = "0.05"; r.value = realOp.value;
      r.setAttribute("aria-label", t(labelKey) + " — " + t("layer.opacity"));
      r.style.cssText = "flex:none;width:64px;";
      r.addEventListener("input", () => { realOp.value = r.value; fireInput(realOp); });
      row.appendChild(r);
    }
    // Upload control (↑) in place of the opacity slider — used by the
    // reference-geometry layer to load a GPX track.
    if (upload) {
      const up = document.createElement("button");
      up.type = "button"; up.className = "secondary"; up.textContent = "↑";
      up.title = t("refgeom.upload"); up.setAttribute("aria-label", t("refgeom.upload"));
      up.style.cssText = "width:24px;height:24px;padding:2px 0;margin:0;flex:none;";
      up.addEventListener("click", () => document.getElementById("refgeom-file")?.click());
      row.appendChild(up);
    }
    return row;
  };
  const renderOrderList = () => {
    if (!orderList) return;
    orderList.innerHTML = "";
    const topToBottom = layerOrder.slice().reverse();
    topToBottom.forEach((key, di) => {
      const v = LAYER_VIS[key] || {};
      orderList.appendChild(buildLayerRow({
        labelKey: `order.${key}`,
        reorder: { key, di, last: topToBottom.length - 1 },
        vis: v.vis, op: v.op, upload: v.upload,
      }));
    });
    FIXED_ROWS.forEach((f) => orderList.appendChild(buildLayerRow({
      labelKey: f.labelKey, reorder: null, vis: f.vis, op: f.op,
    })));
  };
  // Expose to the module scope so setLang() can rebuild the panel in place
  // when it's left open across a language toggle.
  refreshLayerOrderList = renderOrderList;
  const layerCtrlBtns = ["layer-ctrl-open", "layer-ctrl-btn"]
    .map((id) => document.getElementById(id)).filter(Boolean);
  const markLayerBtns = (on) => layerCtrlBtns.forEach((b) => b.classList.toggle("active", on));
  const openOrder = () => { renderOrderList(); orderModal?.classList.add("active"); markLayerBtns(true); };
  const closeOrder = () => { orderModal?.classList.remove("active"); markLayerBtns(false); };
  // Non-blocking corner panel: the buttons TOGGLE it (re-click to dismiss).
  const toggleOrder = () => orderModal?.classList.contains("active") ? closeOrder() : openOrder();
  layerCtrlBtns.forEach((b) => b.addEventListener("click", toggleOrder));
  document.getElementById("layer-order-close")?.addEventListener("click", closeOrder);
  orderModal?.addEventListener("click", (e) => {
    if (e.target === orderModal) closeOrder();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && orderModal?.classList.contains("active")) closeOrder();
  });
  document.getElementById("layer-order-reset")?.addEventListener("click", () => {
    layerOrder = DEFAULT_LAYER_ORDER.slice();
    applyLayerOrder();
    renderOrderList();
  });

  // Restore saved parameter/viz choices and start persisting future edits.
  // Last so the colormap selects are populated and every sub-panel sync
  // handler is already wired (restore dispatches synthetic change events).
  setupParamPersistence();
  setupConfigButtons();
  setupDrawingTools();
});

// attributionControl:false — the on-map attribution strip is removed; the same
// credits live in the help modal instead (the per-layer `attribution:` strings
// below are kept for the record / in case the control is ever re-enabled).
const map = L.map("map", { preferCanvas: true, attributionControl: false }).setView([-23.55, -46.63], 12);
// Leaflet-Geoman's own draw-hint tooltips ("Click to place first vertex", …)
// are English by default and ignore our STRINGS/t() pipeline — set its
// locale to match ours (setLang() re-applies this on toggle).
if (map.pm) map.pm.setLang(currentLang === "pt" ? "pt_br" : "en");

// Explicit stacking for the analysis layers, between Leaflet's default
// overlayPane (z 400) and markerPane (z 600). Without dedicated panes all
// of these share overlayPane and the z-order is whatever DOM order the
// rebuilds produce — notably the drawn vector network used to land above
// or below the passes overlay depending on which was refreshed last.
// The order is user-editable via the "Layer stacking order" modal and
// persisted to localStorage. Default, bottom → top:
// relief < energy < network lines < passes < routes/path.
const LAYER_PANES = {
  relief:     "reliefPane",
  impassable: "impassablePane",
  energy:     "energyPane",
  network:    "networkPane",
  passes:     "passesPane",
  refgeom:    "refgeomPane",
  routes:     "routesPane",
};
const DEFAULT_LAYER_ORDER = ["relief", "impassable", "energy", "network", "passes", "refgeom", "routes"]; // bottom → top
let layerOrder = DEFAULT_LAYER_ORDER.slice();
try {
  const saved = JSON.parse(localStorage.getItem("simu-layer-order") || "null");
  if (
    Array.isArray(saved) &&
    saved.length === DEFAULT_LAYER_ORDER.length &&
    DEFAULT_LAYER_ORDER.every((k) => saved.includes(k))
  ) {
    layerOrder = saved;
  }
} catch {}
for (const pane of Object.values(LAYER_PANES)) map.createPane(pane);

function applyLayerOrder() {
  layerOrder.forEach((key, i) => {
    const pane = map.getPane(LAYER_PANES[key]);
    if (pane) pane.style.zIndex = String(401 + i);
  });
  try { localStorage.setItem("simu-layer-order", JSON.stringify(layerOrder)); } catch {}
}
applyLayerOrder();

// ------- Busca de endereços (geocoding) -------
// Botão 🔍 estacionado na coluna de controles top-left do Leaflet (abaixo do
// zoom +/−), com typeahead via Photon (komoot) — feito pra autocomplete, ao
// contrário do Nominatim, cuja política de uso PROÍBE typeahead. Mesma
// implementação da amora, REDUZIDA de propósito: escolher um resultado APENAS
// voa até o lugar (flyTo) — sem pino, sem waypoint, sem estado persistido.
// Infra que acompanha: photon.komoot.io no connect-src do CSP (index.html) e
// isento do runtime-cache do sw.js (cache-first congelaria cada consulta).
const geoSearchBtn = document.getElementById("geo-search-btn");
const geoSearchPanel = document.getElementById("geo-search-panel");
const geoSearchInput = document.getElementById("geo-search-input");
const geoSearchList = document.getElementById("geo-search-results");
const geoSearchStatus = document.getElementById("geo-search-status");
let geoSearchTimer = null;
let geoSearchAbort = null;     // AbortController da busca em voo (latest-wins)
let geoSearchResults = [];
let geoSearchLastQuery = "";   // query dos resultados exibidos (p/ Enter direto)
let geoSearchActiveIdx = -1;   // item destacado via ↑/↓

// Estaciona o botão na coluna do Leaflet — só aí ele ganha display (o CSS
// esconde .geo-search-btn fora de .leaflet-control-container, então um erro
// antes deste ponto nunca deixa um botão órfão no fluxo do <body>).
{
  const leafletTopLeft = document.querySelector(".leaflet-top.leaflet-left");
  if (geoSearchBtn && leafletTopLeft) {
    leafletTopLeft.appendChild(geoSearchBtn);
    L.DomEvent.disableClickPropagation(geoSearchBtn);
    L.DomEvent.disableScrollPropagation(geoSearchBtn);
  }
}

async function photonGeocode(query) {
  geoSearchAbort?.abort();
  const ctrl = new AbortController();
  geoSearchAbort = ctrl;
  const c = map.getCenter();
  // lat/lon + location_bias_scale puxam o ranking pro que está na tela (São
  // Paulo na prática) sem excluir o resto; sem `lang` — o Photon só tem
  // en/de/fr e resultados BR já vêm em português por padrão.
  const url = "https://photon.komoot.io/api/?" + new URLSearchParams({
    q: query,
    limit: "6",
    lat: c.lat.toFixed(5),
    lon: c.lng.toFixed(5),
    location_bias_scale: "0.4",
    zoom: String(Math.min(16, Math.round(map.getZoom()))),
  });
  const resp = await fetch(url, { signal: ctrl.signal });
  if (!resp.ok) throw new Error(`Photon HTTP ${resp.status}`);
  const data = await resp.json();
  const seen = new Set();
  const items = [];
  for (const f of data.features || []) {
    const p = f.properties || {};
    const [lng, lat] = f.geometry?.coordinates || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = p.osm_id != null ? `${p.osm_type || ""}/${p.osm_id}` : `${lat},${lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = p.name || [p.street, p.housenumber].filter(Boolean).join(", ");
    if (!label) continue;
    const detail = [p.district, p.city, p.state].filter(Boolean).join(", ");
    items.push({ label, detail, lat, lng });
  }
  return items;
}

// O painel é position:fixed — ancora direto no rect (viewport) do botão na
// hora de abrir (a posição varia com zoom control oculto no mobile etc.).
function positionGeoSearchPanel() {
  const btnRect = geoSearchBtn.getBoundingClientRect();
  if (window.innerWidth <= 600) {
    // Tela estreita: largura (quase) toda, abaixo do botão. width:auto
    // libera o esticamento left+right (o CSS fixa 320px pro desktop).
    geoSearchPanel.style.top = `${Math.round(btnRect.bottom + 6)}px`;
    geoSearchPanel.style.left = "8px";
    geoSearchPanel.style.right = "8px";
    geoSearchPanel.style.width = "auto";
  } else {
    geoSearchPanel.style.top = `${Math.round(btnRect.top)}px`;
    geoSearchPanel.style.left = `${Math.round(btnRect.right + 8)}px`;
    geoSearchPanel.style.right = "auto";
    geoSearchPanel.style.width = "";
  }
}

function setGeoSearchStatus(msg) {
  geoSearchStatus.textContent = msg;
  geoSearchStatus.hidden = !msg;
}

function openGeoSearch() {
  positionGeoSearchPanel();
  geoSearchPanel.hidden = false;
  geoSearchBtn.setAttribute("aria-pressed", "true");
  geoSearchInput.focus();
  geoSearchInput.select();
}

function closeGeoSearch() {
  clearTimeout(geoSearchTimer);
  geoSearchAbort?.abort();
  geoSearchPanel.hidden = true;
  geoSearchBtn.setAttribute("aria-pressed", "false");
  setGeoSearchStatus("");
  renderGeoSearchResults([]);
}

function renderGeoSearchResults(items) {
  geoSearchResults = items;
  geoSearchActiveIdx = -1;
  geoSearchInput.removeAttribute("aria-activedescendant");
  geoSearchList.textContent = "";
  items.forEach((item, i) => {
    const li = document.createElement("li");
    li.id = `geo-search-opt-${i}`;
    li.setAttribute("role", "option");
    const label = document.createElement("span");
    label.className = "geo-search-label";
    label.textContent = item.label;   // textContent — nunca innerHTML (dado externo)
    li.appendChild(label);
    if (item.detail) {
      const detail = document.createElement("span");
      detail.className = "geo-search-detail";
      detail.textContent = item.detail;
      li.appendChild(detail);
    }
    li.addEventListener("click", () => pickGeoSearchResult(item));
    geoSearchList.appendChild(li);
  });
}

function setGeoSearchActive(idx) {
  const rows = geoSearchList.children;
  if (!rows.length) return;
  geoSearchActiveIdx = ((idx % rows.length) + rows.length) % rows.length;
  for (let i = 0; i < rows.length; i++) {
    rows[i].classList.toggle("is-active", i === geoSearchActiveIdx);
  }
  const active = rows[geoSearchActiveIdx];
  geoSearchInput.setAttribute("aria-activedescendant", active.id);
  active.scrollIntoView({ block: "nearest" });
}

async function runGeoSearch() {
  const q = geoSearchInput.value.trim();
  if (q.length < 3) {
    geoSearchAbort?.abort();
    renderGeoSearchResults([]);
    setGeoSearchStatus("");
    return;
  }
  setGeoSearchStatus(t("geosearch.searching"));
  try {
    const items = await photonGeocode(q);
    geoSearchLastQuery = q;
    renderGeoSearchResults(items);
    setGeoSearchStatus(items.length ? "" : t("geosearch.none"));
  } catch (err) {
    if (err.name === "AbortError") return; // superada por uma busca mais nova
    console.warn("[geo-search]", err);
    renderGeoSearchResults([]);
    setGeoSearchStatus(t("geosearch.net_error"));
  }
}

// A única ação: fechar o painel e voar até o lugar. Nada de pino/marcador —
// requisito do recurso; o mapa aqui é palco de campos de energia, não de POIs.
function pickGeoSearchResult(item) {
  closeGeoSearch();
  map.flyTo(L.latLng(item.lat, item.lng), Math.max(map.getZoom(), 15));
}

geoSearchBtn?.addEventListener("click", () => {
  if (geoSearchPanel.hidden) openGeoSearch();
  else closeGeoSearch();
});
geoSearchInput?.addEventListener("input", () => {
  clearTimeout(geoSearchTimer);
  geoSearchTimer = setTimeout(runGeoSearch, 350);
});
geoSearchInput?.addEventListener("keydown", (e) => {
  // Nada daqui deve vazar pros handlers globais (Esc fecha modais).
  e.stopPropagation();
  if (e.key === "ArrowDown") {
    e.preventDefault();
    setGeoSearchActive(geoSearchActiveIdx + 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setGeoSearchActive(geoSearchActiveIdx - 1);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const q = geoSearchInput.value.trim();
    if (geoSearchActiveIdx >= 0 && geoSearchResults[geoSearchActiveIdx]) {
      pickGeoSearchResult(geoSearchResults[geoSearchActiveIdx]);
    } else if (geoSearchResults.length && q === geoSearchLastQuery) {
      pickGeoSearchResult(geoSearchResults[0]);
    } else {
      clearTimeout(geoSearchTimer);
      runGeoSearch();
    }
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeGeoSearch();
  }
});

// ------- Basemap -------
// Selectable via the #basemap-select dropdown. Tile entries swap the base
// tile layer; "none-*" entries remove it and paint the map container a
// solid colour (overlays, markers and the optional rmsampa-v2 tiles are
// unaffected — they live in higher panes).
const BASEMAPS = {
  "osm": {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: { attribution: "© OpenStreetMap contributors", maxZoom: 19 },
  },
  "carto-dark": {
    url: "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
    options: {
      attribution: "© OpenStreetMap contributors © CARTO",
      subdomains: "abcd",
      maxZoom: 20,
    },
  },
  "carto-light": {
    url: "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
    options: {
      attribution: "© OpenStreetMap contributors © CARTO",
      subdomains: "abcd",
      maxZoom: 20,
    },
  },
  "esri-satellite": {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    options: { attribution: "© Esri, Maxar, Earthstar Geographics", maxZoom: 19 },
  },
  "none-black": { color: "#000000" },
  "none-white": { color: "#ffffff" },
  "none-gray":  { color: "#808080" },
};

let baseTileLayer = null;
function applyBasemap(key) {
  const def = BASEMAPS[key] || BASEMAPS.osm;
  if (baseTileLayer) { baseTileLayer.remove(); baseTileLayer = null; }
  const container = document.getElementById("map");
  if (def.url) {
    // zIndex 0 keeps the basemap UNDER the rmsampa hydrography overlay (z 10).
    baseTileLayer = L.tileLayer(def.url, { ...def.options, zIndex: 0 }).addTo(map);
    if (container) container.style.background = "";
  } else if (container) {
    container.style.background = def.color;
  }
}
applyBasemap("osm");

// ------- State -------
const state = {
  dem: null, // { height, mask, H, W, dx, dy, bbox, originX, originY }
  src: null, // [r, c]
  dst: null, // [r, c]
  // All live compute workers (1 for regular runs, N for the density pool).
  // computeGen is bumped on every run start AND every cancellation — a
  // worker message whose captured generation doesn't match is stale (the
  // user loaded a new DEM / network mid-compute) and must be dropped, not
  // rendered against the new grid.
  workers: [],
  computeGen: 0,
  // Compute-time calibration, learned by a one-shot probe at DEM load (see
  // startCalibrationProbe). null until the probe lands. calibrationGen is
  // bumped on every DEM load so a stale in-flight probe's result is dropped.
  // backendCores: cached {url, cores} from a /health ping, for the estimate.
  calibration: null,
  calibrationGen: 0,
  probeWorker: null,
  // Set when the calibration probe errors: estimateRunTime blanks the
  // estimate instead of showing "estimating…" forever (computeDone retries).
  calibrationFailed: false,
  backendCores: null,
  // Snapshot of the last compute's config (engine, refs, budget, mode), taken
  // at run start so the post-compute online correction can compare the
  // estimate it would have made against the real elapsed time.
  lastRun: null,
  // Cloud compute-source state machine (see computeMode()/ensureCloudVm()):
  //   mode           — last computeMode() resolved at run start ("cloud" arms it)
  //   orchestratorUrl — base URL of the orchestrator (a public Cloud Run
  //                    service, reachable from any origin, gated by the shared
  //                    cloud password)
  //   vmState        — last STATE seen from /cloud/status (STOPPED/PROVISIONING/
  //                    RUNNING/STOPPING/ERROR)
  //   keepaliveTimer — interval marking "compute in flight" client-side; its
  //                    /cloud/keepalive traffic ALSO registers a short-lived
  //                    lease on the orchestrator (LEASES[clientId], ~180s TTL)
  //                    so a second browser's default "stop after run" can't
  //                    kill the VM out from under a concurrent compute here
  //   clientId       — stable per-tab id (crypto.randomUUID(), generated once)
  //                    sent as X-Simu-Client on /cloud/keepalive and /cloud/stop
  //                    so the orchestrator can tell concurrent clients apart
  //   pollTimer      — interval polling /cloud/status while booting (unused as a
  //                    stored handle; the boot loop awaits inline, kept for clarity)
  //   dataUrl        — VM's HTTPS data-plane base, learned from the orchestrator
  //                    (/cloud/start|status); where /density,/single,/health go
  cloud: { mode: "browser", orchestratorUrl: "", dataUrl: "", vmState: "STOPPED", keepaliveTimer: null, pollTimer: null, clientId: null },
  // Stacked overlays — z-order from bottom up:
  //   OSM basemap → tileOverlay (rmsampa-v2) → energyOverlay → passesOverlay
  tileOverlay: null,
  energyOverlay: null,
  passesOverlay: null,
  pathLine: null,
  routeLines: [],
  srcMarker: null,
  dstMarker: null,
  // Optional XYZ tile overlay (rmsampa-v2). Initialised below.
  tileOverlayActive: false,
  // Outline rectangle drawn to show the loaded DEM's extent.
  demRect: null,
  // Optional rasterised vector network. When non-null, AND'd with the
  // DEM mask before every compute so analysis is constrained to network
  // cells. networkSrsId stamps the source CRS so we can warn on DEM swap.
  networkMask: null,
  networkSrsId: null,
  networkFeatureCount: 0,
  // Parsed network geometry in WGS84 ([[lat,lng], …] per line), kept so the
  // optional "draw network" toggle can render true vector lines at a fixed
  // ground width. null when over the vertex cap (drawing disabled).
  networkLines: null,
  // Per-network-way { deck, layer } tags (parallel to networkLines), captured
  // from the OSM streets pull, for graph-mode bridge/tunnel handling (Phase C:
  // layer-aware junctions + deck flattening). null for .gpkg networks (no tags).
  networkLinesMeta: null,
  // Bridge/tunnel ways extracted from the loaded network (gpkg tags or OSM
  // tags) as [{ latlngs, kind, layer, name }] — fed to the 1d "extract bridges
  // from the loaded network" button (installBridgesFromWays). null if none.
  networkBridgeCandidates: null,
  networkLinesLayer: null,
  // "Follow the vectors" graph mode: the routable graph built from
  // networkLines (cached, keyed by networkGraphToken so a network/junction-mode/
  // DEM change rebuilds it), the last per-edge result, and its map layer.
  networkGraph: null,
  networkGraphToken: null,
  lastGraphResult: null,
  // Graph mode renders as TWO pane-integrated vector layers (energy on
  // energyPane, passes on passesPane) so the existing Energy/Passes visibility
  // + opacity controls drive them, plus a routes/path layer on routesPane.
  graphEnergyLayer: null,
  graphPassesLayer: null,
  graphRoutesLayer: null,
  // Graph energy is shown as an interpolated RASTER (like grid), not vector
  // edges — rasterised from the graph then IDW-filled. Cached for restyle.
  graphEnergyRaster: null,
  // Optional impassable mask (water, etc.). `impassable` is resampled to the
  // DEM grid (1 = impassable); `impassableRaster` keeps the parsed source so
  // the Invert toggle re-resamples without a re-upload. The vector network can
  // carve bridge corridors across it: corridorCells/Base/Ramp cache the
  // reopened cells and their smooth bridge-elevation profile (see
  // recomputeCorridors / buildComputeGrid). impassableToken is bumped on any
  // mask/corridor/offset/invert change so the cached network graph rebuilds.
  impassable: null,
  impassableRaster: null,
  impassableMeta: null,
  corridorCells: null,
  corridorBase: null,
  corridorRamp: null,
  corridorSet: null, // Set of corridor cell indices, for O(1) click-validity lookup
  osmWaterGeom: null, // cached parsed OSM water geometry (grid coords) for re-rasterising on the #imp-rivers toggle
  // Bumped on every rebuildOsmWaterMask() call so overlapping invocations (rapid
  // #imp-rivers toggling) can tell which one is the LAST one started — a
  // superseded call must not apply its (possibly out-of-order-finishing) result.
  waterMaskGen: 0,
  impassableToken: 0,
  impassableOverlay: null,
  // Optional OSM bridges & tunnels modelled as level "decks". Each is a span
  // between two ground abutment cells (endA/endB). In the raster compute they
  // become PORTAL EDGES — a shortcut between the end cells at the flat-deck cost
  // — so the route OVER the bridge and the ground route UNDER it both stay
  // correct (the grid keeps ground elevation everywhere; nothing is overwritten).
  // bridgesToken is bumped on any bridge change so the cached graph + estimate
  // rebuild. See loadOsmBridges / buildPortals / buildComputeGrid.
  bridges: null,       // [{ latlngs, endA, endB, deckLenM, kind, layer, name }]
  bridgesMeta: null,   // { source, count, skipped }
  bridgesToken: 0,
  bridgesLayer: null,  // Leaflet polyline group overlay
  // Multi-reference density: list of [r, c] pixel coords plus their map markers.
  refPoints: [],
  refMarkers: [],
  // Total in-extent population the CURRENT refs proxy (Σ setor pop × in-bbox
  // area fraction, from the census sampler). Each census ref is an equal-share
  // proxy of refPopM/K. Nulled on ANY ref-set change (manual click, clear,
  // non-census placement, file load) — only a fresh census placement sets it.
  refPopM: null,
  // Accessibility KPI cache from the last density run that carried the
  // pairwise ref↔ref energy matrix. { mat (Float32 K×K, OUTBOUND rows:
  // mat[i*K+j] = energy for ref i's trip to ref j under the run's mode),
  // K, refs: [{r,c,lat,lng}] (snapshot at run start), popM, eMax, eMaxMode,
  // mode, unavailable } — see installKpiResult / kpiInvalidate. NOT part of
  // state.lastResult: style re-renders must never touch it.
  kpi: null,
  // Position in the quasi-random (Sobol/Halton) sequence used by "Place
  // random". Persists across clicks so each batch continues the sequence;
  // reset whenever the refs are cleared or the DEM changes.
  qmcIndex: 0,
  // Guards the async "census" sampler so a double-click can't fire two
  // overlapping cloud queries that both clear + re-add reference points.
  censusInFlight: false,
  // Bumped by every DEM initiator (file input, hosted example, FABDEM
  // viewport, Group-0 import) so a slow load that finishes after a newer one
  // was started can detect it's stale and bail before installing (last-CLICK
  // wins) instead of last-FINISHER silently replacing the displayed DEM.
  demLoadGen: 0,
  // Live-ETA bookkeeping (set on Compute, cleared on done/error).
  computeStartedAt: 0,
  estimatedTotalMs: 0,
  // Bundle loaded before (or against the wrong) DEM: held here — including
  // its binary rasters — and re-applied by loadDemFromArrayBuffer once a
  // DEM with matching dimensions arrives. Without this, loading the DEM
  // second wiped everything the bundle had just restored (src/dst, refs)
  // and the rasters were lost, making bundle-then-DEM order useless.
  pendingBundle: null,
};

// Escape user-derived text (file parse errors, worker messages, …) before
// it's interpolated into status.innerHTML — bundles and DEMs are shareable
// artifacts, so error strings echoing their content are attacker-reachable.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

// ---- Compute-source indirection (Browser / Localhost / Cloud) -----------
// The single source of truth for which engine a run uses. `computeMode()`
// reads the selector radios; `effectiveBackendUrl()` maps Localhost→backend
// URL and Cloud→orchestrator URL (both trimmed, trailing slashes stripped).
// Everything downstream (startDensityBackend / startSingleBackend / the binary
// frame builders / the /health probe) is engine-agnostic — it just receives
// the right base URL. The orchestrator mirrors the Rust backend's /density,
// /single, /health byte-for-byte, so Cloud is an opaque pass-through.
function computeMode() {
  return document.querySelector('input[name="compute-source"]:checked')?.value || "browser";
}
function effectiveBackendUrl() {
  const cloud = computeMode() === "cloud";
  // Localhost keeps the historical default (an empty field → the standard
  // backend port). Cloud has no safe default — an empty orchestrator URL blocks
  // the run with cloud.need_orch_url rather than guessing.
  const id = cloud ? "orchestrator-url" : "backend-url";
  const raw = (document.getElementById(id)?.value || "").trim();
  let val = (!cloud && !raw) ? "http://127.0.0.1:8077" : raw;
  // A pasted bare hostname ("simu-orch….run.app") is a RELATIVE URL to fetch()
  // — the POST goes to the app's own origin and fails confusingly (visto na
  // prática contra um dev-server local). Assume https:// when the scheme is
  // missing; loopback hosts get http:// (the native backend has no TLS).
  if (val && !/^[a-z][a-z0-9+.-]*:\/\//i.test(val)) {
    val = (/^(127\.0\.0\.1|localhost|\[::1\])(:|$|\/)/.test(val) ? "http://" : "https://") + val;
  }
  return val.replace(/\/+$/, "");
}
// Kept for reference; Cloud now works from ANY origin (the orchestrator is a
// public Cloud Run service, not loopback), so this no longer gates the radio.
function isLocalOrigin() {
  if (location.protocol === "file:") return true;
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

// Cloud splits into TWO planes: the CONTROL plane is the orchestrator URL
// (effectiveBackendUrl, Cloud Run) — start/stop/status; the DATA plane is the
// VM's HTTPS host (state.cloud.dataUrl, learned from the orchestrator) — where
// the big /density,/single,/health requests go DIRECT (Cloud Run can't proxy
// them: 32 MiB limit). Localhost uses one URL for both. computeDataUrl() is
// what the compute fetches target.
function computeDataUrl() {
  if (computeMode() === "cloud" && state.cloud.dataUrl) return state.cloud.dataUrl;
  return effectiveBackendUrl();
}
// The shared cloud password (Bearer token), from the #cloud-token field. The
// SAME token gates the orchestrator (control) and Caddy on the VM (data).
function cloudToken() {
  return (document.getElementById("cloud-token")?.value || "").trim();
}
// The requested cloud VM size (#cloud-machine). The orchestrator validates
// against its own allowlist and applies it on create / on start-from-stopped.
function cloudMachineType() {
  return document.getElementById("cloud-machine")?.value || "n2-standard-8";
}
// "Falhar em vez de cair pro navegador": a cloud failure aborts the run loudly
// instead of silently recomputing on the laptop (which on a big DEM looks like
// a hang and HIDES the cloud problem — the failure mode of choice all night).
function cloudNoFallback() {
  return !!document.getElementById("cloud-no-fallback")?.checked;
}
// cores + backend memory budget per selectable size — mirrors the orchestrator's
// ALLOWED_MACHINE_TYPES max-mem-gb table × the backend's 0.8 effective factor
// (density_mem_budget_bytes em backend/src/main.rs). Used by the time estimate
// so it tracks the DROPDOWN (the next boot applies it), not the last VM booted.
const CLOUD_MACHINE_SPECS = {
  "n2-standard-8":   { cores: 8,   memBudgetBytes: 28 * 0.8e9 },
  "n2-standard-32":  { cores: 32,  memBudgetBytes: 115 * 0.8e9 },
  "n2-standard-128": { cores: 128, memBudgetBytes: 460 * 0.8e9 },
};
// Backend spec the ESTIMATE should assume. Cloud: the selected machine (a
// running keep-warm VM of another size is transient — default is stop-after-
// run, so the next compute boots the selected size). Localhost: the cached
// /health probe (nulls → the caller's fallbacks).
function backendSpecForEstimate() {
  if (computeMode() === "cloud") {
    const spec = CLOUD_MACHINE_SPECS[cloudMachineType()];
    if (spec) return spec;
  }
  return {
    cores: state.backendCores ? state.backendCores.cores : null,
    memBudgetBytes: state.backendCores ? state.backendCores.memBudgetBytes : null,
  };
}
// Headers for a Cloud data-plane compute request: the Bearer token + an opt-in
// asking the backend to gzip its (large) response (the browser auto-inflates).
// Empty for Localhost (the native backend has no auth).
function cloudComputeHeaders() {
  if (computeMode() !== "cloud") return {};
  const h = { "X-Simu-Gzip": "1" };
  const tok = cloudToken();
  if (tok) h["Authorization"] = `Bearer ${tok}`;
  return h;
}

// Stable per-tab id sent as X-Simu-Client to /cloud/keepalive and /cloud/stop
// so the orchestrator's lease can tell this browser apart from a concurrent
// one (see LEASES in orchestrator/main.py) — generated once, lazily, so a
// session that never touches Cloud never allocates a UUID for nothing.
function cloudClientId() {
  if (!state.cloud.clientId) state.cloud.clientId = crypto.randomUUID();
  return state.cloud.clientId;
}

// Terminate every in-flight compute worker and invalidate their pending
// messages via the generation bump. Safe to call when idle. Must run before
// anything that changes the grid a result would be rendered against (DEM
// load, network load/clear) — see state.computeGen above.
function cancelActiveCompute() {
  state.computeGen++;
  for (const w of state.workers) w.terminate();
  state.workers = [];
  // A superseded cloud run must stop its keepalive traffic — /cloud/keepalive
  // extends this tab's short-lived orchestrator lease (LEASES[clientId]),
  // which is what protects a concurrent second browser's compute from a
  // default "stop after run"; letting a dead run's keepalive linger would
  // needlessly hold that lease. The in-VM idle-watchdog + uptime cap remain
  // the real cost backstops regardless of any lease.
  stopCloudKeepalive();
  if (state.computeStartedAt) {
    state.computeStartedAt = 0;
    progress.classList.remove("active");
    updateRunButtonState();
  }
}

// Last-resort safety net for the async compute dispatch. A SYNCHRONOUS throw
// inside the dispatch bodies (e.g. an OOM allocating buildComputeGrid()/the
// DEM payload on a 135 M-cell grid) escapes as an unhandled rejection that
// would otherwise leave the progress bar spinning, the Run button disabled,
// and "Computing…" stuck — forcing a manual reload. Only act when a compute
// is actually in flight, so unrelated errors don't clobber the UI.
function handleWedgedCompute(detail) {
  if (!state.computeStartedAt) return;
  console.error("[compute] unhandled failure while running:", detail);
  cancelActiveCompute();
  // Run encalhado na nuvem: libera a VM (cancelActiveCompute só corta o
  // keepalive, não desliga a instância).
  if (state.cloud.mode === "cloud" && state.cloud.orchestratorUrl) {
    stopCloudVm(state.cloud.orchestratorUrl);
  }
  const msg = (detail && detail.message) || String(detail || "unknown error");
  status.innerHTML =
    `<span style="color:#ff6b6b">${t("status.compute_failed", escapeHtml(msg))}</span>`;
}
window.addEventListener("unhandledrejection", (e) => handleWedgedCompute(e.reason));
window.addEventListener("error", (e) => handleWedgedCompute(e.error || e.message));

// Cloud: if the tab is hidden or unloaded while a cloud VM is up AND IDLE, stop
// it now (default-ON "stop after each run", extended to the leave-the-page case)
// via a fire-and-forget sendBeacon — a normal fetch wouldn't survive the unload.
// NEVER stop a VM that's mid-compute: visibilitychange→hidden fires on an
// ordinary tab switch / minimize / screen lock, and stopping then would abort
// the in-flight remote run (the stream-proxy fetch drops → it falls back to the
// far slower / OOM-prone browser pool, losing the whole run). keepaliveTimer is
// the precise "a run is in flight" signal — its /cloud/keepalive traffic also
// extends this tab's orchestrator lease, so a hidden tab's OWN dead run can't
// out-live it either. If the tab truly dies mid-run, the in-VM idle-watchdog
// (~15 min) + uptime cap are the only backstops.
function beaconStopCloudVm() {
  if (state.cloud.keepaliveTimer) return; // a compute is running — leave the VM alone
  if (state.cloud.mode === "cloud" && state.cloud.orchestratorUrl) {
    stopCloudVm(state.cloud.orchestratorUrl, { beacon: true });
  }
}
document.addEventListener("visibilitychange", () => {
  // Em modo "manter VM ligada", trocar/esconder a aba NÃO desliga a VM (o
  // watchdog de ócio DENTRO da VM cuida disso — /cloud/keepalive renova o
  // lease deste cliente no orquestrador, mas não é o que decide manter a VM
  // ligada); só um unload real
  // (pagehide) desliga. Sem keep-warm, esconder a aba desliga a VM ociosa
  // (economia padrão). state.computeStartedAt is set BEFORE the cloud dispatch
  // (i.e. already nonzero during VM boot, before startCloudKeepalive() arms
  // keepaliveTimer) — checking it here, not just keepaliveTimer, keeps a
  // hidden tab from stopping the VM mid-boot and dooming the run.
  if (document.visibilityState === "hidden"
      && !state.computeStartedAt
      && !document.getElementById("cloud-keep-warm")?.checked) {
    beaconStopCloudVm();
  }
});
window.addEventListener("pagehide", beaconStopCloudVm);

// ------- DEM loading -------
const demFile = document.getElementById("dem-file");
const demMeta = document.getElementById("dem-meta");
const status = document.getElementById("status");
const runBtn = document.getElementById("run");
const progress = document.getElementById("progress");
const progressBar = progress.querySelector(".bar");
const resultMeta = document.getElementById("result-meta");

// Construct the rmsampa-v2 XYZ tile layer once. Add/remove on visibility
// toggle so we don't pay tile fetches when it's hidden.
const RMSAMPA_URL = "https://telhas.pedalhidrografi.co/rmsampa-v2/{z}/{x}/{y}.png";
state.tileOverlay = L.tileLayer(RMSAMPA_URL, {
  // 21, above the map's z20 ceiling, because detectRetina (below) drops a layer's
  // maxZoom by 1 on HiDPI — at 19 that capped the layer at z18 and the hydrography
  // VANISHED when zoomed past it. 21→20 (retina) keeps it visible (upscaled from
  // z16) across the whole zoomable range.
  maxZoom: 21,
  // rmsampa-v2 only has tiles up to z16. With detectRetina (below) this Leaflet
  // build adds the +1 retina offset AFTER clamping to maxNativeZoom, so a flat
  // cap of 16 fetched z17 on HiDPI (404 → blank hydrography when zoomed in). On
  // retina cap at 15 so the +1 lands exactly on z16; on non-retina (no offset)
  // keep 16 so it still gets full z16 detail. Either way: crisp where real tiles
  // exist, upscaled (never 404) above it.
  maxNativeZoom: L.Browser.retina ? 15 : 16,
  // HiDPI/retina: fetch one zoom higher and draw at half size so the hydrography
  // is crisp instead of 2× upscaled+blurred (capped at z16 by maxNativeZoom 15).
  detectRetina: true,
  opacity: 0.85,
  // Keep the hydrography overlay ABOVE the basemap within the tile pane,
  // regardless of add order (the basemap is re-added on the persistence
  // refire AFTER this layer, which would otherwise bury it until toggled).
  zIndex: 10,
  attribution: 'pedalhidrografi.co',
});

demFile.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const gen = ++state.demLoadGen;
  status.textContent = t("status.loading_dem");
  try {
    const buf = await file.arrayBuffer();
    if (gen !== state.demLoadGen) return; // a newer DEM load started while we were reading — last click wins
    state.demSourceUrl = null;
    await loadDemFromArrayBuffer(buf, file.name, gen);
  } catch (err) {
    console.error(err);
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.error_generic", escapeHtml(err.message))}</span>`;
  }
});

// Three example DEMs hosted alongside the rmsampa-v2 tiles. Wired below.
const DEM_EXAMPLES = [
  { id: "ex-aguapreta", label: "Entorno da Água Preta", size: "instantâneo",
    url: "https://simujaules.pedalhidrografi.co/dem/sampa_aguapreta.tif" },
  { id: "ex-centro",    label: "Sampa Centro Expandido", size: "rápido",
    url: "https://simujaules.pedalhidrografi.co/dem/sampa_centro.tif" },
  { id: "ex-geral",     label: "Sampa Sítio Urbano",    size: "lento",
    url: "https://simujaules.pedalhidrografi.co/dem/sampa_geral.tif" },
];

async function loadDemFromUrl(url, label) {
  const gen = ++state.demLoadGen;
  status.textContent = t("status.fetching", label);
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
    const buf = await resp.arrayBuffer();
    if (gen !== state.demLoadGen) return; // a newer DEM load started while we were fetching — last click wins
    state.demSourceUrl = url;
    await loadDemFromArrayBuffer(buf, label, gen);
  } catch (err) {
    console.error(err);
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.error_generic", escapeHtml(err.message))}</span>`;
  }
}

// Cloud-hosted example datasets: fetch the file → hand it to the normal File
// loader (which gates on a loaded DEM and shows its own progress). Used by the
// "Viário RMSampa" (1B network) and water-mask (1C) example buttons.
async function loadVectorFromUrl(url, label) {
  status.textContent = t("status.fetching", label);
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
    await loadVectorNetwork(new File([await resp.blob()], "sampa-viario.gpkg"));
  } catch (err) {
    console.error(err);
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.gpkg_failed", escapeHtml(err.message))}</span>`;
  }
}
async function loadImpassableFromUrl(url, label) {
  status.textContent = t("status.fetching", label);
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
    await loadImpassableMaskFromFile(new File([await resp.blob()], "water_mask.tif"));
  } catch (err) {
    console.error(err);
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.error_generic", escapeHtml(err.message))}</span>`;
  }
}

// ------- FABDEM viewport loader -------
// Pulls FABDEM 1°×1° tiles that intersect the current map viewport,
// crops each to the visible extent, and stitches them into a single
// in-memory GeoTIFF that we hand to loadDemFromArrayBuffer. Tiles are
// COGs hosted at https://fabdem.pedalhidrografi.co/ (Cloudflare R2 —
// tiles at the ROOT, no /fabdem/ path segment; the old gs://telhas
// mirror is retired for FABDEM, though telhas still serves the rmsampa
// tiles and the viário FGBs) and named
// in the original Bristol convention `{LAT}{NS}{LON}{EW}_FABDEM_V1-2.tif`
// keyed by the SW corner. geotiff.js's fromUrl uses HTTP Range requests
// so we never download more than the visible cells (the 50 MB cap is
// enforced as decompressed pixel-bytes, since that's what we allocate).
//
// CAUTION (bicycling-energy-model journal Entry 19): FABDEM is NOT adequate
// for energy work on flat/urban terrain. Its per-pixel noise inflates h₊ by
// +57% median (up to +135% on flat corpora), and v2Edge's per-grade ε
// amplifies that noise (pooled 17.6% vs 7.1% med |Δ%| against the validated
// local IGC 30 m survey). The IGC-SP DTM (loaded elsewhere in this app) is
// the load-bearing, validated source for São Paulo; treat FABDEM here as a
// convenience for terrain OUTSIDE that coverage, not a substitute for it.

const FABDEM_BASE_URL = "https://fabdem.pedalhidrografi.co/";
const FABDEM_TILE_DEG = 1;          // 1° per tile, keyed by SW corner
const FABDEM_ARCSEC = 1 / 3600;     // ~30 m at the equator
const FABDEM_MAX_BYTES = 50 * 1024 * 1024;

function fabdemTileName(lat, lon) {
  // Naming convention used by this deploy: hemisphere prefix BEFORE digits,
  // e.g. S24W047_FABDEM_V1-2.tif for the tile keyed by SW corner -24, -47.
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${ns}${String(Math.abs(lat)).padStart(2, "0")}${ew}${String(Math.abs(lon)).padStart(3, "0")}_FABDEM_V1-2.tif`;
}

// Browser geolocation → pan the map to the user's coordinates without
// touching the zoom. The user typically frames their area before
// clicking, so we respect whatever zoom they're already at.
function centerOnUserLocation() {
  // Trace point for the "nothing happens when I click" reports — a single
  // log here isolates click-routing problems from geolocation failures.
  console.info("[locate] click handler invoked");
  if (!navigator.geolocation) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("locate.unsupported")}</span>`;
    return;
  }
  status.textContent = t("locate.requesting");
  const btn = document.getElementById("locate-btn");
  if (btn) btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (btn) btn.disabled = false;
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const acc = pos.coords.accuracy; // metres
      // Drop a marker + accuracy circle at the located point (replace any prior).
      if (state.locateMarker) { state.locateMarker.remove(); state.locateMarker = null; }
      if (state.locateCircle) { state.locateCircle.remove(); state.locateCircle = null; }
      state.locateMarker = L.circleMarker([lat, lng], {
        radius: 6, color: "#1f6fd0", weight: 2, fillColor: "#4ea3ff", fillOpacity: 0.9,
      }).addTo(map);
      if (Number.isFinite(acc) && acc > 0) {
        state.locateCircle = L.circle([lat, lng], {
          radius: acc, color: "#1f6fd0", weight: 1, fillColor: "#4ea3ff", fillOpacity: 0.12,
        }).addTo(map);
      }
      // panTo keeps the current zoom; setView would force a zoom change.
      map.panTo([lat, lng]);
      status.textContent = t("locate.centered", lat.toFixed(4), lng.toFixed(4));
    },
    (err) => {
      if (btn) btn.disabled = false;
      // err.code: 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT
      let key = "locate.error";
      if (err.code === 1) key = "locate.denied";
      else if (err.code === 2) key = "locate.unavailable";
      else if (err.code === 3) key = "locate.timeout";
      status.innerHTML = `<span style="color:#ff6b6b">${t(key)}</span>`;
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
  );
}

async function loadFabdemForView() {
  const gen = ++state.demLoadGen;
  if (!map) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.map_not_ready")}</span>`;
    return;
  }
  const bounds = map.getBounds();
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const west  = bounds.getWest();
  const east  = bounds.getEast();
  if (!Number.isFinite(south) || north <= south || east <= west) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.map_bounds_failed")}</span>`;
    return;
  }

  // Snap the output extent to FABDEM's 1-arcsec grid so the synthetic
  // GeoTIFF we hand off has integer-cell origin and dimensions.
  const outWest  = Math.floor(west  * 3600) / 3600;
  const outEast  = Math.ceil (east  * 3600) / 3600;
  const outSouth = Math.floor(south * 3600) / 3600;
  const outNorth = Math.ceil (north * 3600) / 3600;
  const outW = Math.round((outEast  - outWest)  * 3600);
  const outH = Math.round((outNorth - outSouth) * 3600);

  // Cap by allocated pixel-bytes (Float32). 50 MB / 4 = 12.5 M cells, which
  // is roughly a 0.98° × 0.98° square at 1 arcsec — about 110 km on a side
  // at the equator. Beyond that we ask the user to zoom in.
  const estBytes = outW * outH * 4;
  if (estBytes > FABDEM_MAX_BYTES) {
    status.innerHTML =
      `<span style="color:#ff6b6b">${t("status.fabdem_too_large", (estBytes / 1024 / 1024).toFixed(0), outW, outH, FABDEM_MAX_BYTES / 1024 / 1024)}</span>`;
    return;
  }

  // Enumerate 1° tiles whose SW corner lat ∈ [floor(south)..ceil(north)-1]
  // and lon ∈ [floor(west)..ceil(east)-1]. The tiny epsilon on the upper
  // bounds avoids fetching an extra tile when the viewport edge sits
  // exactly on an integer degree.
  const eps = 1e-9;
  const latLo = Math.floor(south);
  const latHi = Math.floor(north - eps);
  const lonLo = Math.floor(west);
  const lonHi = Math.floor(east - eps);
  const tileSpecs = [];
  for (let lat = latLo; lat <= latHi; lat++) {
    for (let lon = lonLo; lon <= lonHi; lon++) {
      tileSpecs.push({
        lat, lon,
        url: FABDEM_BASE_URL + fabdemTileName(lat, lon),
      });
    }
  }

  status.textContent = t("status.fabdem_fetching", tileSpecs.length);
  const fabBtn = document.getElementById("ex-fabdem-view");
  if (fabBtn) fabBtn.disabled = true;
  progress.classList.add("active");
  progressBar.style.width = "0%";

  try {
    // Open each tile (small IFD fetch only — geotiff.js doesn't pull pixels
    // until readRasters is called). 404s are common: oceans and polar
    // strips fall outside FABDEM coverage. We log and skip.
    const opened = [];
    for (let i = 0; i < tileSpecs.length; i++) {
      const tile = tileSpecs[i];
      try {
        const tiff = await GeoTIFF.fromUrl(tile.url);
        const image = await tiff.getImage();
        opened.push({ ...tile, image });
      } catch (e) {
        console.info(`[fabdem] skipping ${tile.url}: ${e.message}`);
      }
      progressBar.style.width = `${((i + 1) / tileSpecs.length * 30).toFixed(1)}%`;
    }

    if (!opened.length) {
      status.innerHTML =
        `<span style="color:#ff6b6b">${t("status.fabdem_none")}</span>`;
      return;
    }

    // Allocate the mosaic. NaN-fill so unwritten cells (gaps between tiles
    // or outside FABDEM coverage) read as nodata in the downstream mask
    // construction (Number.isFinite check in loadDemFromArrayBuffer).
    const mosaic = new Float32Array(outW * outH);
    mosaic.fill(NaN);

    // Read each tile's intersection with the viewport. readRasters({bbox})
    // fetches only the relevant strips/tiles within the COG over HTTP
    // Range requests — that's where the bandwidth saving comes from.
    let placed = 0; // tiles successfully read into the mosaic
    for (let i = 0; i < opened.length; i++) {
      const tile = opened[i];
      const tileSouth = tile.lat;
      const tileNorth = tile.lat + FABDEM_TILE_DEG;
      const tileWest  = tile.lon;
      const tileEast  = tile.lon + FABDEM_TILE_DEG;

      // Snap the intersection to the same arcsec grid as the mosaic so
      // pixel offsets line up exactly.
      const interWest  = Math.max(outWest,  tileWest);
      const interEast  = Math.min(outEast,  tileEast);
      const interSouth = Math.max(outSouth, tileSouth);
      const interNorth = Math.min(outNorth, tileNorth);
      if (interEast <= interWest || interNorth <= interSouth) continue;

      // A single tile's range-read can fail (transient network / partial COG);
      // skip just that tile instead of letting the whole mosaic abort.
      try {
      // Per-tile nodata sentinel — FABDEM uses GDAL_NODATA, varies by tile.
      // Math.fround rounds the sentinel through float32 to match the f32
      // widening the raster values below go through (same rationale as
      // loadDemFromArrayBuffer's mask build).
      const nodataRaw = tile.image.fileDirectory.getValue("GDAL_NODATA");
      const nodata = nodataRaw ? Math.fround(parseFloat(nodataRaw)) : null;

      // Convert the geographic intersection to a pixel window. NB:
      // image.readRasters({bbox}) does NOT exist on GeoTIFFImage — only
      // the top-level tiff.readRasters supports bbox. Passing it to the
      // image-level call silently falls back to "read full image", which
      // would blow the 50 MB cap AND scramble the mosaic placement below.
      // We compute the pixel window ourselves from the source's origin
      // and resolution so geotiff.js issues Range requests for just the
      // strips overlapping the viewport.
      const [oX, oY] = tile.image.getOrigin();
      const [rX, rY] = tile.image.getResolution(); // rX > 0 east, rY < 0 down
      const wnd = [
        Math.round((interWest  - oX) / rX),
        Math.round((interNorth - oY) / rY),
        Math.round((interEast  - oX) / rX),
        Math.round((interSouth - oY) / rY),
      ];
      const raster = await tile.image.readRasters({
        window: wnd,
        samples: [0], // FABDEM tiles are single-band — explicit for consistency with loadDemFromArrayBuffer
        interleave: true,
      });
      const rW = wnd[2] - wnd[0];
      const rH = wnd[3] - wnd[1];

      // Place into mosaic. Mosaic origin is (outWest, outNorth) at row 0,
      // col 0; rows count southward.
      const colOffset = Math.round((interWest - outWest)  * 3600);
      const rowOffset = Math.round((outNorth - interNorth) * 3600);
      for (let r = 0; r < rH; r++) {
        const mr = rowOffset + r;
        if (mr < 0 || mr >= outH) continue;
        for (let c = 0; c < rW; c++) {
          const mc = colOffset + c;
          if (mc < 0 || mc >= outW) continue;
          const v = raster[r * rW + c];
          if (Number.isFinite(v) && (nodata === null || v !== nodata)) {
            mosaic[mr * outW + mc] = v;
          }
        }
      }
      placed++;
      } catch (err) {
        console.warn(`[fabdem] tile ${fabdemTileName(tile.lat, tile.lon)} read failed — skipping:`, err);
      }
      progressBar.style.width = `${(30 + (i + 1) / opened.length * 70).toFixed(1)}%`;
      status.textContent = t("status.fabdem_mosaic", i + 1, opened.length);
    }
    if (placed === 0) {
      progress.classList.remove("active");
      status.innerHTML = `<span style="color:#ff6b6b">${t("status.fabdem_all_failed")}</span>`;
      return;
    }
    // Some (but not all) tiles failed to read — the mosaic still loads, but
    // with NaN gaps where those tiles should be. Surface that beyond the
    // console.warn above so the user doesn't mistake the gap for FABDEM
    // coverage.
    const failed = opened.length - placed;

    // Wrap the mosaic as a GeoTIFF in memory so loadDemFromArrayBuffer
    // can ingest it like any other DEM. Same writer we use for bundle
    // outputs — Float32, EPSG:4326, north-up.
    const tiffMd = {
      width:  outW,
      height: outH,
      BitsPerSample:    [32],
      SampleFormat:     [3],
      SamplesPerPixel:  [1],
      ModelPixelScale:  [FABDEM_ARCSEC, FABDEM_ARCSEC, 0],
      ModelTiepoint:    [0, 0, 0, outWest, outNorth, 0],
      GeographicTypeGeoKey: 4326,
      GTModelTypeGeoKey: 2,
      GTRasterTypeGeoKey: 1,
    };
    const buf = GeoTIFF.writeArrayBuffer(mosaic, tiffMd);

    if (gen !== state.demLoadGen) return; // a newer DEM load started while we were fetching/mosaicking — last click wins
    state.demSourceUrl = `FABDEM viewport ${outWest.toFixed(2)},${outSouth.toFixed(2)} → ${outEast.toFixed(2)},${outNorth.toFixed(2)} (${placed} tile${placed === 1 ? "" : "s"})`;
    await loadDemFromArrayBuffer(buf, `FABDEM ${outW}×${outH} (${placed} tile${placed === 1 ? "" : "s"})`, gen);
    if (failed > 0) {
      status.innerHTML = `<span style="color:#ff9d3d">${t("status.fabdem_partial", failed, opened.length)}</span>`;
    }
  } catch (err) {
    console.error(err);
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.fabdem_failed", escapeHtml(err.message))}</span>`;
  } finally {
    progress.classList.remove("active");
    if (fabBtn) fabBtn.disabled = false;
  }
}

// Static DEM pre-smoothing (v55, journal Entry 20's validated mitigation for the
// Entry-19 fine-DEM over-charge): sequential per-axis mask-normalized Gaussian
// (rows then columns), truncation 3σ, per-axis σ_px from the geotransform, in
// place, O(rows) temp memory (~10 s at 135 M cells). Runs app-side at DEM load
// only — heights then ship identically to the JS worker, graph engine and Rust
// backend, so there are NO engine/parity implications. test-dem-smoothing.mjs
// holds the verbatim mirror + reference tests (hand-kept-in-sync, like the
// other engine mirrors); the Entry-20 harness (goal_calibration.mjs Phase A)
// validated this exact scheme, so σ choices are only meaningful for THIS
// transform — don't swap in a plain gaussian blur.
function smoothHeightsInPlace(height, mask, H, W, dxM, dyM, sigmaM) {
  if (!(sigmaM > 0)) return;
  const passes = [
    { sigPx: sigmaM / dxM, horizontal: true },
    { sigPx: sigmaM / dyM, horizontal: false },
  ];
  for (const p of passes) {
    const R = Math.ceil(3 * p.sigPx);
    if (!(R >= 1)) continue;
    const w = new Float64Array(R + 1);
    for (let k = 0; k <= R; k++) w[k] = Math.exp(-(k * k) / (2 * p.sigPx * p.sigPx));
    if (p.horizontal) {
      const buf = new Float64Array(W);
      for (let r = 0; r < H; r++) {
        const base = r * W;
        for (let c = 0; c < W; c++) {
          const idx = base + c;
          if (!mask[idx]) continue;
          let num = w[0] * height[idx], den = w[0];
          for (let k = 1; k <= R; k++) {
            const a = c - k, b = c + k;
            if (a >= 0 && mask[base + a]) { num += w[k] * height[base + a]; den += w[k]; }
            if (b < W && mask[base + b]) { num += w[k] * height[base + b]; den += w[k]; }
          }
          buf[c] = num / den;
        }
        for (let c = 0; c < W; c++) if (mask[base + c]) height[base + c] = buf[c];
      }
    } else {
      // Vertical pass, row-major streaming: for output row r, accumulate the
      // (2R+1) source rows r±k sequentially into num/den, then defer the
      // write by R rows via a ring buffer (source rows must stay unmodified
      // while they can still appear in a later output row's window).
      const num = new Float64Array(W), den = new Float64Array(W);
      const ring = []; // { row, vals: Float64Array }
      const flushRow = (entry) => {
        const base = entry.row * W;
        for (let c = 0; c < W; c++) if (mask[base + c]) height[base + c] = entry.vals[c];
      };
      for (let r = 0; r < H; r++) {
        num.fill(0); den.fill(0);
        const k0 = Math.max(0, r - R), k1 = Math.min(H - 1, r + R);
        for (let rr = k0; rr <= k1; rr++) {
          const wk = w[Math.abs(rr - r)], base = rr * W;
          for (let c = 0; c < W; c++) {
            if (mask[base + c]) { num[c] += wk * height[base + c]; den[c] += wk; }
          }
        }
        const vals = new Float64Array(W);
        const base = r * W;
        for (let c = 0; c < W; c++) vals[c] = mask[base + c] ? num[c] / den[c] : height[base + c];
        ring.push({ row: r, vals });
        // Flush rows whose window can no longer include any unwritten source row.
        while (ring.length && ring[0].row <= r - R) flushRow(ring.shift());
      }
      while (ring.length) flushRow(ring.shift());
    }
  }
}

// 1A — crop the loaded DEM to the current map viewport. Implemented as an
// in-memory export→reimport: writeRasterAsGeoTIFF on the sub-grid window, then
// the standard loadDemFromArrayBuffer path — so compute cancellation, the mask
// rebuild (GDAL_NODATA round-trip; nodata cells still hold the raw sentinel in
// state.dem.height), CRS GeoKeys, layer/graph invalidation, the calibration
// probe AND the smoothing tag guard (an already-smoothed DEM is not
// re-smoothed; the cumulative σ tag travels with the crop) are all inherited
// from the one battle-tested load path instead of re-implemented here.
async function cropDemToViewport() {
  const dem = state.dem;
  if (!dem) { status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(t("io.no_dem"))}</span>`; return; }
  // The map (and this viewport read) is EPSG:4326-only — same guard as the
  // OSM pulls: on a projected DEM lon/lat would map to garbage cells.
  if (!dem.isGeographic) { status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(t("status.crop_need_geo"))}</span>`; return; }
  const b = map.getBounds();
  // Viewport ∩ DEM extent (degrees), then cell indices (row 0 = north edge).
  const west  = Math.max(b.getWest(),  dem.bbox.xmin);
  const east  = Math.min(b.getEast(),  dem.bbox.xmax);
  const north = Math.min(b.getNorth(), dem.bbox.ymax);
  const south = Math.max(b.getSouth(), dem.bbox.ymin);
  if (!(west < east && south < north)) { status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(t("status.crop_no_overlap"))}</span>`; return; }
  const c0 = Math.max(0, Math.floor((west - dem.originX) / dem.dx));
  const c1 = Math.min(dem.W, Math.ceil((east - dem.originX) / dem.dx));
  const r0 = Math.max(0, Math.floor((dem.originY - north) / dem.dy));
  const r1 = Math.min(dem.H, Math.ceil((dem.originY - south) / dem.dy));
  const Wc = c1 - c0, Hc = r1 - r0;
  if (Wc < 2 || Hc < 2) { status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(t("status.crop_too_small"))}</span>`; return; }
  if (Wc === dem.W && Hc === dem.H) { status.textContent = t("status.crop_noop"); return; }
  const vals = new Float32Array(Hc * Wc);
  for (let r = 0; r < Hc; r++) {
    const src = (r0 + r) * dem.W + c0;
    vals.set(dem.height.subarray(src, src + Wc), r * Wc);
  }
  const demLike = {
    H: Hc, W: Wc,
    dx: dem.dx, dy: dem.dy,
    originX: dem.originX + c0 * dem.dx,
    originY: dem.originY - r0 * dem.dy,
    isGeographic: dem.isGeographic,
    geoKeys: dem.geoKeys,
  };
  const extraMd = {};
  if (dem.nodata != null) extraMd.GDAL_NODATA = String(dem.nodata);
  if (dem.smoothCumSigmaM > 0) extraMd.ImageDescription = `simujaules:demSmoothSigmaM=${dem.smoothCumSigmaM}`;
  const label = t("dem.crop_label", state.demLabel || "DEM", Wc, Hc);
  const gen = ++state.demLoadGen;
  // A crop is a local derivation — the source URL (if any) describes the FULL
  // raster and would mislabel bundles made from the crop. Same convention as
  // the file-picker path.
  state.demSourceUrl = null;
  try {
    const buf = writeRasterAsGeoTIFF(vals, demLike, "float32", Object.keys(extraMd).length ? extraMd : undefined);
    await loadDemFromArrayBuffer(buf, label, gen);
  } catch (e) {
    status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(e.message)}</span>`;
  }
}

// 1A — downsample the loaded DEM by an integer factor via mask-aware N×N
// block averaging (each output cell = mean of its block's VALID cells; a
// block with none stays nodata). This is the same transform as
// `gdalwarp -r average` — on the 5 m IGC-SP rasters a 6× reduction lands at
// ~30 m, the regime where the v2 model is most accurate (journal Entries
// 19/21). Same export→reimport tail as cropDemToViewport, so the standard
// load path (mask rebuild, GeoKeys, invalidations, smoothing-tag guard)
// is inherited. Works on projected DEMs too (no viewport involved).
async function downsampleDem(factor) {
  const dem = state.dem;
  if (!dem) { status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(t("io.no_dem"))}</span>`; return; }
  const N = Math.max(2, factor | 0);
  const W2 = Math.ceil(dem.W / N), H2 = Math.ceil(dem.H / N);
  if (W2 < 2 || H2 < 2) { status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(t("status.downsample_too_small", W2, H2))}</span>`; return; }
  status.textContent = t("status.downsampling", N);
  await new Promise((r) => setTimeout(r, 0)); // let the status line paint before the sync pass
  const vals = new Float32Array(H2 * W2);
  // Masked output cells get the source sentinel (loader rebuilds the mask from
  // GDAL_NODATA below) or NaN when the source had none (loader masks
  // non-finite values).
  const sentinel = dem.nodata != null ? dem.nodata : NaN;
  for (let R = 0; R < H2; R++) {
    const rmax = Math.min(dem.H, (R + 1) * N);
    for (let C = 0; C < W2; C++) {
      const cmax = Math.min(dem.W, (C + 1) * N);
      let sum = 0, n = 0;
      for (let r = R * N; r < rmax; r++) {
        const base = r * dem.W;
        for (let c = C * N; c < cmax; c++) {
          if (dem.mask[base + c]) { sum += dem.height[base + c]; n++; }
        }
      }
      vals[R * W2 + C] = n > 0 ? sum / n : sentinel;
    }
  }
  const demLike = {
    H: H2, W: W2,
    dx: dem.dx * N, dy: dem.dy * N,
    originX: dem.originX,
    originY: dem.originY,
    isGeographic: dem.isGeographic,
    geoKeys: dem.geoKeys,
  };
  const extraMd = {};
  if (dem.nodata != null) extraMd.GDAL_NODATA = String(dem.nodata);
  // The cumulative-smoothing tag travels (block averaging is a resampling,
  // not a Gaussian — the tag tracks σ only). Note the auto-smoothing rule
  // won't re-fire anyway once the pixel grows past 10 m.
  if (dem.smoothCumSigmaM > 0) extraMd.ImageDescription = `simujaules:demSmoothSigmaM=${dem.smoothCumSigmaM}`;
  const label = t("dem.downsample_label", state.demLabel || "DEM", N, W2, H2);
  const gen = ++state.demLoadGen;
  state.demSourceUrl = null; // local derivation, same convention as the crop
  try {
    const buf = writeRasterAsGeoTIFF(vals, demLike, "float32", Object.keys(extraMd).length ? extraMd : undefined);
    await loadDemFromArrayBuffer(buf, label, gen);
  } catch (e) {
    status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(e.message)}</span>`;
  }
}

async function loadDemFromArrayBuffer(buf, label, gen) {
  // A compute still running against the previous DEM would render arrays
  // sized to the old H×W onto the new grid — kill it before anything else.
  cancelActiveCompute();
  status.textContent = t("status.loading_label", label);
  const tiff = await GeoTIFF.fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const W = image.getWidth();
  const H = image.getHeight();
  // geotiff.js 3.x: getTiePoints() is async and fileDirectory is an
  // ImageFileDirectory object — values are read via getValue('TagName').
  const tiePoints = await image.getTiePoints();
  const fileDirectory = image.fileDirectory;
  const pixelScale = fileDirectory.getValue("ModelPixelScale");
  if (!pixelScale || !tiePoints?.length) {
    throw new Error(t("status.dem_no_geotransform"));
  }
  const dx = pixelScale[0];
  const dy = pixelScale[1];
  const originX = tiePoints[0].x;
  const originY = tiePoints[0].y;

  // Read elevation as Float32Array. samples: [0] selects band 0 explicitly —
  // without it, geotiff.js's interleave:true on a multi-band GeoTIFF (RGB
  // terrain render, elevation+mask stack, …) returns ALL bands pixel-
  // interleaved and this loader would silently read 1/k of the image's
  // bands smeared across the whole grid as "elevation".
  const raster = await image.readRasters({ samples: [0], interleave: true });
  const height = raster instanceof Float32Array ? raster : Float32Array.from(raster);

  // Build mask: anything finite and != nodata. Math.fround rounds the
  // sentinel through float32 BEFORE comparing — height[] is always the f64
  // widening of an f32 value, so an unrounded f64 parse of GDAL_NODATA can
  // silently fail to match the stored sentinel (e.g. a Float64 source whose
  // nodata isn't f32-representable, or a truncated-precision GDAL_NODATA
  // string), letting nodata cells slip through as "valid" elevations.
  const nodataRaw = fileDirectory.getValue("GDAL_NODATA");
  const nodata = nodataRaw ? Math.fround(parseFloat(nodataRaw)) : null;
  const mask = new Uint8Array(H * W);
  for (let i = 0; i < H * W; i++) {
    const v = height[i];
    mask[i] = (Number.isFinite(v) && (nodata === null || v !== nodata)) ? 1 : 0;
  }

  // Pull the source TIFF's GeoKeys up front: they declare the real CRS (so a
  // COARSE geographic DEM with dx ≥ 0.01° isn't mis-read as projected by the
  // magnitude heuristic), and they're also stamped onto exported GeoTIFFs.
  let geoKeys = null;
  try {
    geoKeys = image.getGeoKeys ? image.getGeoKeys() : null;
  } catch { /* getGeoKeys throws on some malformed tiffs — fine to skip */ }

  // The map, overlays and click-to-pick are EPSG:4326-only. Prefer the TIFF's
  // declared model type (GTModelTypeGeoKey: 1=projected, 2=geographic); fall
  // back to a coordinate-magnitude heuristic only when GeoKeys are absent.
  const modelType = geoKeys && geoKeys.GTModelTypeGeoKey;
  const isProbablyGeographic =
    modelType === 2 ? true
      : modelType === 1 ? false
      : (Math.abs(originX) < 360 && Math.abs(originY) < 90 && dx < 0.01);
  if (isProbablyGeographic) {
    status.innerHTML = `<span style="opacity:0.7">${t("status.dem_lonlat")}</span>`;
  }

  // Convert degrees → metres for geographic DEMs using a flat-earth
  // approximation centred on the DEM's middle latitude. For a 5–50 km
  // extent this is good to ~0.3%.
  const latRef = isProbablyGeographic ? originY - (H * dy) / 2 : 0;
  const dxM = isProbablyGeographic
    ? dx * 111320 * Math.cos((latRef * Math.PI) / 180)
    : dx;
  const dyM = isProbablyGeographic ? dy * 110574 : dy;

  // (geoKeys was read above, before CRS classification. It's stamped onto any
  // GeoTIFFs we export later — energy.tif / passes.tif / network.tif — so
  // projected DEMs round-trip with their real CRS, not a bare 4326.)

  // Re-check the caller's generation token HERE, right before the
  // point-of-no-return: every caller only checks ONCE, right after its own
  // fetch/read completes and before calling this function — but GeoTIFF
  // parsing above (fromArrayBuffer/getImage/getTiePoints/readRasters) is
  // itself async, so a SECOND, newer load can start and finish (bumping
  // state.demLoadGen) while an OLDER call is still in here. Without this,
  // whichever parse finishes last installs its DEM — last-FINISHER, not
  // last-CLICK — silently overwriting a newer, already-displayed DEM.
  if (gen !== undefined && gen !== state.demLoadGen) {
    status.textContent = t("status.load_superseded");
    return;
  }

  // Static pre-smoothing (v55, journal Entry 20; re-baselined v64 by
  // bicycling-energy-model Entry 74). "auto" applies σ = 30 m to EVERY
  // source — coarse ones (FABDEM 30 m) included: the Entry-74 ε contest
  // showed the deployed grade-local ε wins on σ30-treated chains on both
  // DTMs while raw chains invert the ordering (noise manufactures steep
  // micro-descents the grade-local policy refuses to credit), so the old
  // fine-only σ10 rule under-treated. The ImageDescription tag guard stays:
  // sources already smoothed (our own dem.tif exports carry the tag) are
  // skipped — guards double-smoothing on re-import. An explicit σ choice
  // overrides the guard. Runs AFTER the generation re-check so a superseded
  // load never burns the worst-case pass (~30 s at σ30 on 135 M cells).
  const imgDescRaw = fileDirectory.getValue ? fileDirectory.getValue("ImageDescription") : null;
  const srcSmoothSigmaM = parseFloat((String(imgDescRaw || "").match(/simujaules:demSmoothSigmaM=([0-9.]+)/) || [])[1]) || 0;
  const smoothSel = document.getElementById("dem-smooth")?.value ?? "auto";
  let smoothSigmaM = 0;
  if (smoothSel === "auto") {
    smoothSigmaM = (srcSmoothSigmaM > 0) ? 0 : 30;
  } else {
    smoothSigmaM = Math.max(0, parseFloat(smoothSel) || 0);
  }
  if (smoothSigmaM > 0) {
    status.textContent = t("status.dem_smoothing", smoothSigmaM);
    await new Promise((r) => setTimeout(r, 0)); // let the status line paint before the sync pass
    smoothHeightsInPlace(height, mask, H, W, dxM, dyM, smoothSigmaM);
  }

  // A new DEM invalidates the cached network graph (elevations changed).
  state.networkGraph = null; state.networkGraphToken = null;
  state.dem = {
    height, mask, H, W,
    dx, dy,                  // native CRS units (degrees for geographic)
    dxM, dyM,                // always metres — fed to the worker
    originX, originY,
    // bbox in DEM CRS units (degrees for geographic):
    bbox: { xmin: originX, ymin: originY - H * dy, xmax: originX + W * dx, ymax: originY },
    isGeographic: isProbablyGeographic,
    geoKeys,                 // for GeoTIFF round-trip on export
    nodata,                  // source GDAL_NODATA sentinel (f32-rounded), or null — re-emitted by exportDemTif so the round trip doesn't turn nodata cells into valid terrain
    smoothSigmaM,            // σ applied by THIS load (0 = none)
    // Cumulative smoothing across export/re-import cycles (Gaussians compose
    // in quadrature) — stamped into exported dem.tif's ImageDescription so the
    // auto rule never double-smooths a re-imported export.
    smoothCumSigmaM: Math.hypot(srcSmoothSigmaM, smoothSigmaM),
  };
  state.demLabel = label;

  // Draw a rectangle around the DEM extent (so the user sees what cells
  // they're working with) and pan/zoom the map to fit.
  if (state.demRect) { state.demRect.remove(); state.demRect = null; }
  if (isProbablyGeographic) {
    const south = originY - H * dy;
    const north = originY;
    const west = originX;
    const east = originX + W * dx;
    const bounds = [[south, west], [north, east]];
    state.demRect = L.rectangle(bounds, {
      color: "#ff8c42",
      weight: 1.5,
      fillOpacity: 0,
      dashArray: "4 3",
      interactive: false,
    }).addTo(map);
    map.fitBounds(bounds, { padding: [20, 20], maxZoom: 16 });
  }

  // Clear any prior energy / passes / relief overlay + clicked points so
  // we don't leave stale visuals from the previous DEM hanging around.
  if (state.energyOverlay)     { state.energyOverlay.remove();     state.energyOverlay = null; }
  if (state.passesOverlay)     { state.passesOverlay.remove();     state.passesOverlay = null; }
  if (state.demReliefOverlay)  { state.demReliefOverlay.remove();  state.demReliefOverlay = null; }
  state.demSlope = null;
  state.demReliefDataUrl = null;
  if (state.pathLine)      { state.pathLine.remove();      state.pathLine = null; }
  if (state.routeLines)    { for (const ln of state.routeLines) ln.remove(); state.routeLines = []; }
  if (state.srcMarker)     { state.srcMarker.remove();     state.srcMarker = null; }
  if (state.dstMarker)     { state.dstMarker.remove();     state.dstMarker = null; }
  if (state.refMarkers && state.refMarkers.length) {
    for (const m of state.refMarkers) m.remove();
  }
  state.refMarkers = [];
  state.refPoints = [];
  state.qmcIndex = 0;
  state.refPopM = null;
  kpiInvalidate();
  state.src = null;
  state.dst = null;
  state.lastResult = null;
  // New DEM → previous calibration is meaningless; invalidate it and any
  // in-flight probe (gen bump) so the estimate shows "estimating…" until a
  // fresh probe lands.
  state.calibration = null;
  state.calibrationGen++;
  state.calibrationFailed = false;
  if (state.probeWorker) { state.probeWorker.terminate(); state.probeWorker = null; }
  // Drop any previously loaded vector network — its rasterised mask is
  // sized to the *previous* DEM's H×W and would corrupt the next compute
  // (or crash) if reused. The user re-uploads the .gpkg if they want it.
  // Drop the impassable mask + corridors BEFORE clearing the network: they're
  // sized to the previous DEM's grid, and clearVectorNetwork →
  // onNetworkCorridorsChanged would otherwise recalibrate against a stale,
  // wrong-sized mask. No dirty cascade — the loader already cancelled compute
  // and starts its own probe below.
  state.impassable = null;
  state.impassableRaster = null;
  state.impassableMeta = null;
  state.corridorCells = null; state.corridorBase = null; state.corridorRamp = null;
  state.corridorSet = null;
  state.osmWaterGeom = null; // grid-bound geometry is stale for a new DEM
  if (state.impassableOverlay) { state.impassableOverlay.remove(); state.impassableOverlay = null; }
  const impInputReset = document.getElementById("impassable-file");
  if (impInputReset) impInputReset.value = "";
  clearVectorNetwork();
  updateImpassableMeta();
  updateCorridorAvailability();
  // Bridges too — endA/endB are cell indices sized to the previous DEM's grid.
  state.bridges = null;
  state.bridgesMeta = null;
  if (state.bridgesLayer) { state.bridgesLayer.remove(); state.bridgesLayer = null; }
  updateBridgeMeta();
  syncRefDisplay();
  document.getElementById("src-display").textContent = t("pts.click_map");
  document.getElementById("dst-display").textContent = t("pts.optional");
  document.getElementById("src-display").classList.remove("set");
  document.getElementById("dst-display").classList.remove("set");
  resultMeta.innerHTML = "—";

  // Display metadata. For geographic DEMs (EPSG:4326), dx/dy are in
  // degrees and need to be converted to metres for cell-size and coverage
  // figures. We use a flat-earth approximation good to ~0.3% at typical
  // cycling-region scales.
  const cellLabel = formatCellSize(dx, dy, originY, H, isProbablyGeographic);
  const coverLabel = formatCoverage(W, H, dx, dy, originY, isProbablyGeographic);
  const originLabel = isProbablyGeographic
    ? `${originX.toFixed(4)}°, ${originY.toFixed(4)}°`
    : `${originX.toFixed(1)}, ${originY.toFixed(1)}`;
  demMeta.innerHTML = `
    ${t("dem.meta_size", W, H, cellLabel)}<br/>
    ${t("dem.meta_origin", originLabel)}<br/>
    ${coverLabel}
  `;
  demMeta.removeAttribute("data-i18n"); // live content — don't let a lang toggle wipe it
  if (state.dem.isGeographic) {
    status.textContent = t("status.dem_loaded", label);
  } else {
    // Projected/unknown CRS: Leaflet is EPSG:4326-only, so the DEM can't be
    // placed on the map — overlays, click-to-pick and relief are all
    // unavailable (don't claim "click to set source"). Tell the user plainly.
    status.innerHTML = `<span style="color:#ff9d3d">${t("status.dem_projected", escapeHtml(label))}</span>`;
  }
  updateRunButtonState();
  syncLoadedHighlights(); // light up group 1A (and 1B was just cleared above)
  // Auto-expand: a fresh DEM opens the next input step (1B) + the compute setup.
  setGroupOpen("network-group", true);
  setGroupOpen("group-3", true);
  setGroupOpen("params-group", true);
  setGroupOpen("pick-points-group", true);
  setGroupOpen("execution-group", true);
  estimateRunTime();
  // Re-grid any drawn geometry against the new DEM (it may have been restored
  // from a config import before a DEM was loaded, or the DEM just changed).
  if ((state.drawnImpassable && state.drawnImpassable.length) ||
      (state.drawnPassable && state.drawnPassable.length) ||
      (state.drawnPortals && state.drawnPortals.length)) {
    state.drawnImpassableMask = rasterizeRingsToMask(state.drawnImpassable);
    state.drawnPassableMask = rasterizeRingsToMask(state.drawnPassable);
    state.bridges = (state.bridges || []).filter((b) => !b.drawn);
    reappendDrawnPortals();
    applyBridgeOverlay(); // the bridge layer was just cleared on DEM load — redraw drawn portal decks
    if (typeof updateDrawMeta === "function") updateDrawMeta();
  }

  // Build the cmocean.phase + slope hillshade for the new DEM. Renders
  // synchronously — for a 12 M-cell viewport (the FABDEM cap) this takes
  // about a second; the user already paid for the DEM load so the extra
  // delay is rolled into that. The relief overlay is wired into the
  // standard layer-controls; it stays hidden until the user toggles it.
  // Skip the (expensive) relief build on non-geographic DEMs — the
  // imageOverlay path is gated on isGeographic too, so we'd just be
  // burning a few seconds of slope/render compute and a 5–20 MB
  // PNG that never gets displayed.
  if (state.dem.isGeographic) {
    try {
      // Slope array is 4·H·W bytes — for a 135 M-cell DEM that's 540 MB.
      // We compute it, hand it to the renderer once, then drop the reference
      // immediately. The render output is a tiny PNG dataURL; the raw slope
      // grid is never read again unless the user reloads the DEM.
      const slopeArr = computeSlope(height, mask, H, W,
                                    state.dem.dxM, state.dem.dyM);
      state.demReliefDataUrl = renderReliefToDataURL(state.dem, slopeArr);
      state.demSlope = null;  // free the float buffer after render
      applyDemReliefOverlay();
    } catch (err) {
      console.warn("[relief] failed to build hillshade:", err);
      state.demSlope = null;
      state.demReliefDataUrl = null;
    }
  }
  // Reveal the layer-block now that the data exists.
  const reliefRow = document.getElementById("relief-row");
  if (reliefRow) reliefRow.style.display = state.demReliefDataUrl ? "" : "none";
  applyLayerControls();

  // Calibrate the compute-time estimate for this DEM (async, off-thread).
  startCalibrationProbe();

  // A bundle was loaded before this DEM (or against a mismatched one) and
  // is waiting in state.pendingBundle. If this DEM matches its grid,
  // re-apply it now — parameters, src/dst/ref markers, and the cached
  // rasters all come back without a recompute.
  if (state.pendingBundle) {
    const pb = state.pendingBundle;
    const bH = pb.md.dem?.H, bW = pb.md.dem?.W;
    // bundleDemMatch also checks the geotransform (not just H×W) — a
    // same-size DEM from a different tile must NOT replay the pending
    // bundle's binaries onto it (see the function's own comment).
    if (bundleDemMatch(pb.md.dem, state.dem) !== false) {
      state.pendingBundle = null; // applyMetadataToUI re-stashes only on mismatch
      applyMetadataToUI(pb.md, pb.bin);
    } else {
      status.innerHTML =
        `<span style="color:#ff9d3d">${t("status.bundle_dem_mismatch_pending", W, H, bW, bH)}</span>`;
    }
  }
}

// ------- Vector network loader (GeoPackage) -------
// Reads a .gpkg via sql.js, finds the (first) geometry table, reprojects
// LineString features into the DEM CRS via proj4js, and rasterises them
// with Bresenham into a binary network mask. The mask is AND'd with the
// DEM mask before each compute so analysis is constrained to the lines.

let _sqlPromise = null;
function getSQL() {
  if (!_sqlPromise) {
    if (typeof initSqlJs !== "function") {
      return Promise.reject(new Error(t("status.sqljs_unavailable")));
    }
    // sql.js fetches sql-wasm.wasm from this CDN ON FIRST GeoPackage open. Like
    // the other CDN libs it is runtime-cached (sw.js), NOT precached — so
    // offline GeoPackage import requires opening a .gpkg at least once while
    // online (same caveat as DEMs). initSqlJs rejects below if it's missing.
    _sqlPromise = initSqlJs({
      locateFile: (f) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}`,
    }).catch((err) => { _sqlPromise = null; throw err; }); // let a later retry re-fetch
  }
  return _sqlPromise;
}

// ------- Group 0: input-dataset export / import -------
// Round-trips the four inputs in the SAME format on both ends: 1A DEM + 1C mask
// as GeoTIFF (reusing writeRasterAsGeoTIFF, georeferenced from state.dem), 1B
// network + 1D bridges as GeoPackage. The .gpkg WRITER below inverts
// parseGpkgGeom/parseWKB — a sql.js DB carrying the OGC metadata tables and one
// StandardGeoPackageBinary LineString blob per feature, all WGS84 (EPSG:4326), so
// loadVectorNetwork / parseGpkgGeom read them straight back.

function ioDownload(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// (WGS84_WKT — the EPSG:4326 definition gpkg_spatial_ref_sys needs so the reader's
// proj4 resolves srs_id 4326 — is declared near the GeoTIFF export below.)

// Encode one polyline ([[lat,lng],…]) as a StandardGeoPackageBinary LineString
// blob: 8-byte header (GP magic, version, flags=no-envelope/LE, srs_id) + WKB
// (LE byte order, type 2, vertex count, then [lng,lat] float64 pairs). The exact
// inverse of parseGpkgGeom + parseWKB; coords stay [x=lng, y=lat] (no swap).
function encodeGpkgLineString(latlngs, srsId) {
  const n = latlngs.length;
  const buf = new ArrayBuffer(8 + 9 + n * 16);
  const dv = new DataView(buf);
  let o = 0;
  dv.setUint8(o++, 0x47); dv.setUint8(o++, 0x50);   // "GP"
  dv.setUint8(o++, 0x00);                           // version 0
  dv.setUint8(o++, 0x01);                           // flags: LE header, no envelope
  dv.setInt32(o, srsId, true); o += 4;              // srs_id (little-endian)
  dv.setUint8(o++, 0x01);                           // WKB byte order: little-endian
  dv.setUint32(o, 2, true); o += 4;                 // WKB type: LineString
  dv.setUint32(o, n, true); o += 4;                 // vertex count
  for (let i = 0; i < n; i++) {
    dv.setFloat64(o, latlngs[i][1], true); o += 8;  // X = lng
    dv.setFloat64(o, latlngs[i][0], true); o += 8;  // Y = lat
  }
  return new Uint8Array(buf);
}

// Build a GeoPackage (Uint8Array) of LineString features. `features` =
// [{ latlngs:[[lat,lng],…], attrs:{colName:value} }]; `attrCols` = [{name,type}].
async function buildGeoPackage(features, { tableName, attrCols = [] }) {
  const SQL = await getSQL();
  const db = new SQL.Database();
  const SRS = 4326;
  try {
    db.run("PRAGMA application_id = 1196444487;"); // 'GPKG' — flags the file as a GeoPackage
    db.run("PRAGMA user_version = 10401;");
    db.run("CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);");
    db.run("CREATE TABLE gpkg_contents (table_name TEXT PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change TEXT NOT NULL, min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER);");
    db.run("CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL, PRIMARY KEY (table_name, column_name));");
    db.run("INSERT INTO gpkg_spatial_ref_sys VALUES ('Undefined cartesian SRS',-1,'NONE',-1,'undefined',''),('Undefined geographic SRS',0,'NONE',0,'undefined',''),('WGS 84 geodetic',4326,'EPSG',4326,?,'');", [WGS84_WKT]);
    const colDefs = attrCols.map((c) => `, "${c.name}" ${c.type || "TEXT"}`).join("");
    db.run(`CREATE TABLE "${tableName}" (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom BLOB${colDefs});`);
    db.run("INSERT INTO gpkg_geometry_columns VALUES (?, 'geom', 'LINESTRING', ?, 0, 0);", [tableName, SRS]);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const cols = ["geom", ...attrCols.map((c) => `"${c.name}"`)].join(", ");
    const ph = ["?", ...attrCols.map(() => "?")].join(", ");
    const stmt = db.prepare(`INSERT INTO "${tableName}" (${cols}) VALUES (${ph});`);
    for (const f of features) {
      if (!f.latlngs || f.latlngs.length < 2) continue;
      for (const [lat, lng] of f.latlngs) {
        if (lng < minX) minX = lng; if (lng > maxX) maxX = lng;
        if (lat < minY) minY = lat; if (lat > maxY) maxY = lat;
      }
      const vals = [encodeGpkgLineString(f.latlngs, SRS),
        ...attrCols.map((c) => { const v = f.attrs ? f.attrs[c.name] : null; return v == null ? null : v; })];
      stmt.run(vals);
    }
    stmt.free();
    if (!Number.isFinite(minX)) { minX = minY = maxX = maxY = 0; }
    db.run("INSERT INTO gpkg_contents (table_name, data_type, identifier, last_change, min_x, min_y, max_x, max_y, srs_id) VALUES (?, 'features', ?, ?, ?, ?, ?, ?, ?);",
      [tableName, tableName, new Date().toISOString(), minX, minY, maxX, maxY, SRS]);
    return db.export();
  } finally {
    db.close();
  }
}

// 1A — DEM raster → GeoTIFF.
function exportDemTif() {
  if (!state.dem) { status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(t("io.no_dem"))}</span>`; return; }
  try {
    // Re-emit the source GDAL_NODATA tag so a re-imported dem.tif reconstructs
    // the same mask — without it, nodata cells (still holding the raw
    // sentinel in state.dem.height) round-trip as "valid" terrain. Also stamp
    // the cumulative pre-smoothing σ (v55): the exported surface IS the
    // smoothed one, and the tag stops loadDemFromArrayBuffer's auto rule from
    // smoothing it again on re-import.
    const extraMd = {};
    if (state.dem.nodata != null) extraMd.GDAL_NODATA = String(state.dem.nodata);
    if (state.dem.smoothCumSigmaM > 0) extraMd.ImageDescription = `simujaules:demSmoothSigmaM=${state.dem.smoothCumSigmaM}`;
    ioDownload(new Uint8Array(writeRasterAsGeoTIFF(state.dem.height, state.dem, "float32", Object.keys(extraMd).length ? extraMd : undefined)), "dem.tif", "image/tiff");
    status.textContent = t("io.exported", "dem.tif");
  } catch (e) { status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(e.message)}</span>`; }
}

// 1C — impassable mask raster → GeoTIFF (DEM-aligned uint8, same as the bundle).
function exportMaskTif() {
  if (!state.dem || !state.impassable) { status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(t("io.no_mask"))}</span>`; return; }
  try {
    ioDownload(new Uint8Array(writeRasterAsGeoTIFF(state.impassable, state.dem, "uint8")), "impassable_mask.tif", "image/tiff");
    status.textContent = t("io.exported", "impassable_mask.tif");
  } catch (e) { status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(e.message)}</span>`; }
}

// 1B — vector network → GeoPackage. Carries the per-way {deck, layer} tags so the
// file is self-describing in a GIS (loadVectorNetwork doesn't read them back into
// networkLinesMeta yet — same limitation as any .gpkg network).
async function exportNetworkGpkg() {
  if (!state.networkLines || !state.networkLines.length) { status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(t("io.no_network"))}</span>`; return; }
  try {
    const meta = state.networkLinesMeta;
    const features = state.networkLines.map((ll, i) => ({
      latlngs: ll,
      attrs: { deck: meta && meta[i] ? (meta[i].deck ? 1 : 0) : null, layer: meta && meta[i] ? meta[i].layer : null },
    }));
    const bytes = await buildGeoPackage(features, { tableName: "network", attrCols: [{ name: "deck", type: "INTEGER" }, { name: "layer", type: "INTEGER" }] });
    ioDownload(bytes, "network.gpkg", "application/geopackage+sqlite3");
    status.textContent = t("io.exported", "network.gpkg");
  } catch (e) { status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(e.message)}</span>`; }
}

// 1D — bridges/portals → GeoPackage (LineStrings + kind/layer/name/eleA/eleB).
// Drawn portals are excluded (they persist through the config, like the bundle).
async function exportBridgesGpkg() {
  const bridges = (state.bridges || []).filter((b) => !b.drawn);
  if (!bridges.length) { status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(t("io.no_bridges"))}</span>`; return; }
  try {
    const features = bridges.map((b) => ({
      latlngs: b.latlngs,
      attrs: { kind: b.kind || null, layer: b.layer ?? null, name: b.name || null, eleA: b.eleA ?? null, eleB: b.eleB ?? null },
    }));
    const bytes = await buildGeoPackage(features, { tableName: "bridges", attrCols: [
      { name: "kind", type: "TEXT" }, { name: "layer", type: "INTEGER" }, { name: "name", type: "TEXT" },
      { name: "eleA", type: "REAL" }, { name: "eleB", type: "REAL" }] });
    ioDownload(bytes, "bridges.gpkg", "application/geopackage+sqlite3");
    status.textContent = t("io.exported", "bridges.gpkg");
  } catch (e) { status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(e.message)}</span>`; }
}

// 1D import — read a bridges .gpkg (the inverse of exportBridgesGpkg) and feed it
// to installBridgesFromWays. Assumes WGS84 geometry (what we write); a geographic
// DEM is required for the lat/lng→cell abutment mapping.
async function importBridgesGpkg(file) {
  if (!state.dem) { status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(t("io.no_dem_first"))}</span>`; return; }
  if (!state.dem.isGeographic) { status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(t("bridges.need_geographic"))}</span>`; return; }
  const SQL = await getSQL();
  const db = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
  try {
    const gc = db.exec("SELECT table_name, column_name FROM gpkg_geometry_columns LIMIT 1");
    if (!gc.length) throw new Error(t("io.gpkg_invalid"));
    const tbl = gc[0].values[0][0], gcol = gc[0].values[0][1] || "geom";
    const info = db.exec(`PRAGMA table_info("${tbl}")`);
    const present = info.length ? info[0].values.map((r) => r[1]) : [];
    const extra = ["kind", "layer", "name", "eleA", "eleB"].filter((c) => present.includes(c));
    const sel = [`"${gcol}"`, ...extra.map((c) => `"${c}"`)].join(", ");
    const res = db.exec(`SELECT ${sel} FROM "${tbl}"`);
    const ways = [];
    if (res.length) {
      for (const row of res[0].values) {
        let lines = null;
        try { lines = parseGpkgGeom(row[0]); } catch { lines = null; }
        if (!lines) continue;
        const at = {}; extra.forEach((c, i) => { at[c] = row[1 + i]; });
        for (const coords of lines) {
          const latlngs = coords.map(([lng, lat]) => [lat, lng]);
          if (latlngs.length < 2) continue;
          ways.push({ latlngs, kind: at.kind || "bridge", layer: Number.isFinite(at.layer) ? at.layer : 0,
            name: at.name || null, eleA: Number.isFinite(at.eleA) ? at.eleA : null, eleB: Number.isFinite(at.eleB) ? at.eleB : null });
        }
      }
    }
    if (!ways.length) throw new Error(t("io.gpkg_no_lines"));
    installBridgesFromWays(ways, file.name);
  } finally {
    db.close();
  }
}

// Parse a GeoPackage StandardGeoPackageBinary blob into an array of
// [x, y] coordinates, or null when the geometry isn't a (Multi)LineString.
// Header layout per OGC GeoPackage 1.4 §2.1.3.
function parseGpkgGeom(blob) {
  if (!(blob instanceof Uint8Array) || blob.length < 8) return null;
  if (blob[0] !== 0x47 || blob[1] !== 0x50) return null; // "GP"
  const flags = blob[3];
  const envelopeType = (flags >> 1) & 0x07;
  const envBytes = [0, 32, 48, 48, 64, 0, 0, 0][envelopeType] || 0;
  const wkbStart = 8 + envBytes;
  if (blob.length < wkbStart + 9) return null;

  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  return parseWKB(view, wkbStart);
}

// Decode a WKB geometry-type word into the 2-D base type and the per-vertex
// byte stride. Handles both dimension encodings in the wild:
//   ISO/OGC: base + 1000·Z + 2000·M + 3000·ZM  (LineString Z = 1002 — what
//            QGIS writes into GeoPackages by default for 3-D sources)
//   EWKB:    flag bits 0x80000000 (Z) / 0x40000000 (M)
// The old code masked with `t & 0x0fff`, which left ISO-typed geometries
// (1002, 1005, …) unrecognised — 3-D .gpkg files silently rasterised to an
// empty network.
function wkbTypeInfo(t) {
  const code = t & 0x0fffffff;       // drop EWKB flag bits
  const base = code % 1000;          // ISO offsets: 1002 → 2, 3005 → 5
  const isoDim = Math.floor(code / 1000) | 0;
  const hasZ = (t & 0x80000000) !== 0 || isoDim === 1 || isoDim === 3;
  const hasM = (t & 0x40000000) !== 0 || isoDim === 2 || isoDim === 3;
  return { base, stride: 16 + (hasZ ? 8 : 0) + (hasM ? 8 : 0) };
}

// Every read is bounds-guarded against view.byteLength: a corrupt/truncated
// blob — or a header mis-aligned by an unrecognised GeoPackage envelope type
// — must return null (the caller skips that one feature) rather than throw a
// RangeError out of getFloat64/getUint32 that aborts the entire .gpkg load.
function parseWKB(view, off) {
  const len = view.byteLength;
  if (off + 5 > len) return null;
  const le = view.getUint8(off) === 1;
  off += 1;
  const t = view.getUint32(off, le);
  off += 4;
  const { base: baseType, stride } = wkbTypeInfo(t);

  if (baseType === 2) {
    // LineString
    if (off + 4 > len) return null;
    const n = view.getUint32(off, le); off += 4;
    if (off + n * stride > len) return null; // truncated / absurd vertex count
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = [view.getFloat64(off, le), view.getFloat64(off + 8, le)];
      off += stride;
    }
    return [out];
  }
  if (baseType === 5) {
    // MultiLineString — skip outer header per child too
    if (off + 4 > len) return null;
    const k = view.getUint32(off, le); off += 4;
    const lines = [];
    for (let j = 0; j < k; j++) {
      if (off + 5 > len) return null;
      const subLE = view.getUint8(off) === 1; off += 1;
      const subT = view.getUint32(off, subLE); off += 4;
      const { base: subBase, stride: subStride } = wkbTypeInfo(subT);
      if (subBase !== 2) return null;
      if (off + 4 > len) return null;
      const n = view.getUint32(off, subLE); off += 4;
      if (off + n * subStride > len) return null; // truncated / absurd
      const ln = new Array(n);
      for (let i = 0; i < n; i++) {
        ln[i] = [view.getFloat64(off, subLE), view.getFloat64(off + 8, subLE)];
        off += subStride;
      }
      lines.push(ln);
    }
    return lines;
  }
  return null;
}

// Bresenham 8-connected line draw onto a 1D row-major mask. Plots a
// "stamp" of (2*halfWidth + 1) cells for line widths > 1.
function rasterLine(r0, c0, r1, c1, mask, W, H, halfWidth) {
  const dr = Math.abs(r1 - r0);
  const dc = Math.abs(c1 - c0);
  const sr = r0 < r1 ? 1 : -1;
  const sc = c0 < c1 ? 1 : -1;
  let err = dc - dr;
  let r = r0, c = c0;
  // Hard iteration cap. A line clipped to the grid plots at most ~(W+H) cells.
  // A wrong-CRS .gpkg can yield endpoints MILLIONS of cells apart (one far NW,
  // one far SE) that slip past the off-grid cull at the call sites; without a
  // cap this Bresenham walk runs for millions of steps on the main thread and
  // freezes the tab. Such a network rasterises to ~0 in-grid cells and is
  // rejected downstream, so bailing early only affects the pathological case.
  let guard = 2 * (W + H) + 4 * halfWidth + 16;
  while (guard-- > 0) {
    for (let pdr = -halfWidth; pdr <= halfWidth; pdr++) {
      const rr = r + pdr;
      if (rr < 0 || rr >= H) continue;
      const rowOff = rr * W;
      for (let pdc = -halfWidth; pdc <= halfWidth; pdc++) {
        const cc = c + pdc;
        if (cc < 0 || cc >= W) continue;
        mask[rowOff + cc] = 1;
      }
    }
    if (r === r1 && c === c1) break;
    const e2 = 2 * err;
    if (e2 > -dr) { err -= dr; c += sc; }
    if (e2 <  dc) { err += dc; r += sr; }
  }
}

function readFileWithProgress(file, onFrac) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error("FileReader error"));
    fr.onprogress = (e) => {
      if (e.lengthComputable) onFrac(e.loaded / e.total);
    };
    fr.readAsArrayBuffer(file);
  });
}

async function loadVectorNetwork(file) {
  if (!state.dem) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.load_dem_first")}</span>`;
    return;
  }
  // state.dem is replaced wholesale on every DEM load, so object identity is
  // a correct epoch token: if it changes during this multi-second rasterise
  // (await points below), the mask we're building is sized to a DEM that no
  // longer exists — bail instead of installing it onto the new one.
  const demRef = state.dem;

  // In-progress status lives in the network section's own meta line — it's
  // contextual to where the user clicked, and the global `status` stays
  // free for messages from other parts of the app.
  const vecMeta = document.getElementById("vec-meta");
  const setVecStatus = (html) => { if (vecMeta) vecMeta.innerHTML = html; };

  // Reuse the compute progress bar. File-read phase fills 0–40 %, sql.js
  // init 40–50 %, rasterise 50–100 %.
  progress.classList.add("active");
  progressBar.style.width = "0%";
  // db is declared outside the try so the finally below can close it, but
  // only ever gets assigned INSIDE the try — so a failure in the file-read/
  // sql.js-init awaits (which run before it exists) still reaches the
  // finally and clears the progress bar instead of leaving it stuck active.
  let db = null;
  try {
    setVecStatus(t("status.vec_reading", escapeHtml(file.name), (file.size / 1024 / 1024).toFixed(0)));
    const buf = await readFileWithProgress(file, (frac) => {
      progressBar.style.width = `${(frac * 40).toFixed(1)}%`;
    });
    progressBar.style.width = "40%";

    setVecStatus(t("status.vec_init_sql"));
    const SQL = await getSQL();
    db = new SQL.Database(new Uint8Array(buf));
    progressBar.style.width = "50%";

    // Prefer a line-geometry layer — a multi-layer .gpkg (OSM extract with
    // landuse polygons + roads lines, a QGIS project export, …) whose FIRST
    // registered layer isn't lines would otherwise parse every geometry blob
    // to null (parseGpkgGeom only accepts (Multi)LineString) and fail with a
    // misleading "0 cells" error even though a usable layer exists. Fall
    // back to the unfiltered query for generic 'GEOMETRY'-typed or
    // single-layer files.
    let cont = db.exec(
      "SELECT table_name, column_name, srs_id FROM gpkg_geometry_columns " +
      "WHERE upper(geometry_type_name) IN ('LINESTRING','MULTILINESTRING','MULTICURVE','CURVE') LIMIT 1",
    );
    if (!cont.length) cont = db.exec("SELECT table_name, column_name, srs_id FROM gpkg_geometry_columns LIMIT 1");
    if (!cont.length) throw new Error(t("io.gpkg_invalid"));
    const tableName = cont[0].values[0][0];
    // Geometry column name from the metadata — QGIS/ogr2ogr default to
    // "geom", but "geometry"/"shape" exist in the wild; hardcoding "geom"
    // made those files fail to load.
    const geomCol   = cont[0].values[0][1] || "geom";
    // SQLite lets TEXT live in INTEGER columns, so a crafted .gpkg could
    // smuggle HTML through srs_id into the innerHTML sinks below (and into
    // the gpkg_spatial_ref_sys query). Coerce once at the source; the
    // 0 fallback means "undefined SRS" and keeps the isSrcWgs check working.
    const rawSrsId  = Number(cont[0].values[0][2]);
    const srsId     = Number.isFinite(rawSrsId) ? rawSrsId : 0;

    // Detect attribute columns we can flag bridges/tunnels with — OSM-export
    // schemas vary: some have dedicated bridge/tunnel/layer columns, others
    // pack them into an hstore `other_tags` string. We SELECT whichever exist
    // alongside the geometry so loadVectorNetwork can capture bridge candidates
    // for the 1d "extract from loaded network" feature, without a re-parse.
    let allCols = [];
    try {
      const ti = db.exec(`PRAGMA table_info("${tableName}")`);
      if (ti.length) allCols = ti[0].values.map((v) => String(v[1]));
    } catch {}
    const tagCols = ["bridge", "tunnel", "layer", "name", "other_tags"].filter((c) => allCols.includes(c));

    // Resolve source CRS for proj4. WGS84 is built in; everything else
    // uses the WKT/PROJ string from gpkg_spatial_ref_sys.
    const isSrcWgs = srsId === 4326 || srsId === 0 || srsId === -1;
    if (!isSrcWgs) {
      const srsRes = db.exec(
        `SELECT definition FROM gpkg_spatial_ref_sys WHERE srs_id = ${srsId}`,
      );
      if (!srsRes.length || !srsRes[0].values[0][0]) {
        throw new Error(`Source SRS ${srsId} has no definition in gpkg_spatial_ref_sys`);
      }
      proj4.defs(`EPSG:${srsId}`, srsRes[0].values[0][0]);
    }

    // DEM bounds in source CRS for the rtree filter — keeps us from
    // burning every line in a country-scale .gpkg when the DEM is small.
    const { originX, originY, H, W, dx, dy } = state.dem;
    const south = originY - H * dy, north = originY;
    const west  = originX,         east  = originX + W * dx;
    let xmin, xmax, ymin, ymax;
    if (isSrcWgs) {
      xmin = west;  xmax = east;
      ymin = south; ymax = north;
    } else {
      const corners = [
        [west, south], [east, south], [east, north], [west, north],
      ].map(([x, y]) => proj4("EPSG:4326", `EPSG:${srsId}`, [x, y]));
      xmin = Math.min(...corners.map((p) => p[0]));
      xmax = Math.max(...corners.map((p) => p[0]));
      ymin = Math.min(...corners.map((p) => p[1]));
      ymax = Math.max(...corners.map((p) => p[1]));
    }

    // Try the rtree-filtered query first; fall back to a full scan if the
    // table isn't there.
    const rtree = `rtree_${tableName}_${geomCol}`;
    let stmt, totalFeatures = 0, useRtree = true;
    try {
      // Pre-count for the progress bar.
      const cnt = db.prepare(
        `SELECT COUNT(*) FROM "${rtree}" WHERE minx <= ? AND maxx >= ? AND miny <= ? AND maxy >= ?`,
      );
      cnt.bind([xmax, xmin, ymax, ymin]);
      cnt.step();
      totalFeatures = cnt.get()[0] | 0;
      cnt.free();
      stmt = db.prepare(`
        SELECT t."${geomCol}"${tagCols.map((c) => `, t."${c}"`).join("")} FROM "${tableName}" t
        WHERE t.fid IN (
          SELECT id FROM "${rtree}"
          WHERE minx <= ? AND maxx >= ? AND miny <= ? AND maxy >= ?
        )
      `);
      stmt.bind([xmax, xmin, ymax, ymin]);
    } catch (e) {
      console.info("[gpkg] no rtree, full scan:", e.message);
      useRtree = false;
      try {
        const cnt = db.prepare(`SELECT COUNT(*) FROM "${tableName}"`);
        cnt.step();
        totalFeatures = cnt.get()[0] | 0;
        cnt.free();
      } catch {}
      stmt = db.prepare(`SELECT "${geomCol}"${tagCols.map((c) => `, "${c}"`).join("")} FROM "${tableName}"`);
    }
    // Geometry is row[0]; tag columns follow in tagCols order.
    const tagIdx = {}; tagCols.forEach((c, i) => { tagIdx[c] = i + 1; });

    const lineWidth = Math.max(1, parseInt(document.getElementById("vec-width")?.value, 10) || 1);
    const halfWidth = (lineWidth - 1) >> 1;
    const networkMask = new Uint8Array(W * H);

    const project = isSrcWgs ? (xy) => xy : (xy) => proj4(`EPSG:${srsId}`, "EPSG:4326", xy);

    let scanned = 0, rasterised = 0;
    // Collect WGS84 geometry for the optional vector rendering. Capped so a
    // monster network can't blow up memory / the Leaflet canvas — past the
    // cap we keep rasterising but stop storing, and disable the draw toggle.
    const VEC_RENDER_VERTEX_CAP = 2_000_000;
    let storedVertices = 0;
    let collected = [];
    // Bridge/tunnel ways extracted for the 1d "from loaded network" feature.
    const bridgeCandidates = [];
    const extractWayTags = (row) => {
      const get = (c) => (tagIdx[c] != null ? row[tagIdx[c]] : null);
      const ot = get("other_tags");
      const otv = (k) => { if (!ot) return null; const m = ot.match(new RegExp('"' + k + '"=>"([^"]*)"')); return m ? m[1] : null; };
      const bridge = get("bridge") || otv("bridge");
      const tunnel = get("tunnel") || otv("tunnel");
      const isBridge = (bridge && bridge !== "no") || tunnel === "yes";
      if (!isBridge) return { isBridge: false };
      const kind = tunnel === "yes" ? "tunnel" : "bridge";
      const layerRaw = get("layer") || otv("layer");
      return { isBridge: true, kind, layer: parseInt(layerRaw, 10) || (kind === "tunnel" ? -1 : 1), name: get("name") || otv("name") || null };
    };
    while (stmt.step()) {
      const row = stmt.get();
      const blob = row[0];
      scanned++;
      // parseGpkgGeom is bounds-guarded, but wrap defensively so any single
      // malformed geometry is skipped rather than aborting the whole load.
      let lines = null;
      try { lines = parseGpkgGeom(blob); } catch { lines = null; }
      if (!lines) continue;
      const tg = tagCols.length ? extractWayTags(row) : { isBridge: false };
      for (const coords of lines) {
        const keepRender = collected !== null && storedVertices < VEC_RENDER_VERTEX_CAP;
        // Build latlngs when rendering OR when this is a bridge/tunnel (we always
        // want a deck candidate's geometry, even past the render cap).
        const lineLatLngs = (keepRender || tg.isBridge) ? [] : null;
        let prevR = null, prevC = null;
        for (const xy of coords) {
          const [lng, lat] = project(xy);
          if (lineLatLngs) lineLatLngs.push([lat, lng]);
          if (keepRender) storedVertices++;
          const c = Math.floor((lng - originX) / dx);
          const r = Math.floor((originY - lat) / dy);
          if (prevR !== null) {
            // Clip wildly-out-of-bounds lines fast — we do per-pixel
            // bounds checks inside rasterLine but skipping segments that
            // are entirely outside saves a lot of pixel iterations.
            if (!(
              (prevR < 0 && r < 0) || (prevR >= H && r >= H) ||
              (prevC < 0 && c < 0) || (prevC >= W && c >= W)
            )) {
              rasterLine(prevR, prevC, r, c, networkMask, W, H, halfWidth);
            }
          }
          prevR = r; prevC = c;
        }
        if (lineLatLngs && lineLatLngs.length > 1) {
          if (keepRender) collected.push(lineLatLngs);
          if (tg.isBridge) bridgeCandidates.push({ latlngs: lineLatLngs, kind: tg.kind, layer: tg.layer, name: tg.name });
        }
        if (storedVertices >= VEC_RENDER_VERTEX_CAP && collected !== null) {
          console.warn(`[network] geometry over ${VEC_RENDER_VERTEX_CAP} vertices — vector rendering disabled, raster mask unaffected.`);
          collected = null;
        }
        rasterised++;
      }
      if (scanned % 2000 === 0) {
        const frac = totalFeatures > 0 ? scanned / totalFeatures : 0;
        progressBar.style.width = `${(50 + frac * 50).toFixed(1)}%`;
        setVecStatus(totalFeatures > 0
          ? t("status.vec_rasterising_of", scanned, totalFeatures, rasterised)
          : t("status.vec_rasterising_scan", scanned, rasterised));
        await new Promise((r) => setTimeout(r, 0));
        if (state.dem !== demRef) {
          status.textContent = t("status.load_superseded");
          return;
        }
      }
    }
    stmt.free();
    progressBar.style.width = "100%";

    let networkCells = 0;
    for (let i = 0; i < networkMask.length; i++) if (networkMask[i]) networkCells++;

    if (state.dem !== demRef) {
      status.textContent = t("status.load_superseded");
      return;
    }

    if (networkCells === 0) {
      // Rasterised to nothing — almost always a CRS or geometry-type
      // mismatch with the DEM. DON'T store the mask: an empty mask AND'd
      // with the DEM would make every click un-snappable and Compute
      // unusable. Say so loudly instead.
      document.getElementById("vec-meta").innerHTML =
        t("status.net_meta_zero", srsId, scanned, rasterised);
      document.getElementById("vec-meta").removeAttribute("data-i18n");
      status.innerHTML = `<span style="color:#ff6b6b">${t("status.net_zero_cells")}</span>`;
      return;
    }

    state.networkMask = networkMask;
    state.networkSrsId = srsId;
    state.networkFeatureCount = rasterised;
    document.getElementById("vec-meta").innerHTML =
      `EPSG:${srsId} · ` + t("status.net_meta_drawn", rasterised, networkCells.toLocaleString(), (100 * networkCells / (W * H)).toFixed(1));
    document.getElementById("vec-meta").removeAttribute("data-i18n");
    status.textContent = t("status.network_loaded");
    state.lastResult = null; // previous compute used the un-constrained mask
    kpiInvalidate();         // …including the accessibility matrix
    cancelActiveCompute();   // …and so would an in-flight one
    state.networkLines = collected;
    state.networkLinesMeta = null; // .gpkg graph-mode bridge flattening not wired (tags live per-feature, not per-kept-line)
    state.networkBridgeCandidates = bridgeCandidates.length ? bridgeCandidates : null;
    applyNetworkLinesOverlay();
    syncLoadedHighlights(); // light up group 1B
    setGroupOpen("impassable-group", true); // network loaded → next input step
    onNetworkCorridorsChanged(); // a new network may carve corridors over the mask
  } finally {
    if (db) db.close();
    progress.classList.remove("active");
  }
}

// Rasterise an array of WGS84 polylines ([[lat,lng], …] each) onto the DEM
// grid and install the result as the active network (mask, meta, rendering,
// compute invalidation). Shared tail for non-gpkg network sources (OSM).
function installNetworkFromLines(lines, srsId, sourceLabel, meta = null) {
  const { originX, originY, H, W, dx, dy } = state.dem;
  const lineWidth = Math.max(1, parseInt(document.getElementById("vec-width")?.value, 10) || 1);
  const halfWidth = (lineWidth - 1) >> 1;
  const networkMask = new Uint8Array(W * H);
  let rasterised = 0;
  for (const coords of lines) {
    let prevR = null, prevC = null;
    for (const [lat, lng] of coords) {
      const c = Math.floor((lng - originX) / dx);
      const r = Math.floor((originY - lat) / dy);
      if (prevR !== null && !(
        (prevR < 0 && r < 0) || (prevR >= H && r >= H) ||
        (prevC < 0 && c < 0) || (prevC >= W && c >= W)
      )) {
        rasterLine(prevR, prevC, r, c, networkMask, W, H, halfWidth);
      }
      prevR = r; prevC = c;
    }
    rasterised++;
  }

  let networkCells = 0;
  for (let i = 0; i < networkMask.length; i++) if (networkMask[i]) networkCells++;
  if (networkCells === 0) {
    status.innerHTML =
      `<span style="color:#ff6b6b">${t("status.net_zero_cells_src", escapeHtml(sourceLabel))}</span>`;
    return false;
  }

  state.networkMask = networkMask;
  state.networkSrsId = srsId;
  state.networkFeatureCount = rasterised;
  document.getElementById("vec-meta").innerHTML =
    `${escapeHtml(sourceLabel)} · ` + t("status.net_meta_drawn", rasterised, networkCells.toLocaleString(), (100 * networkCells / (W * H)).toFixed(1));
  document.getElementById("vec-meta").removeAttribute("data-i18n");
  status.textContent = t("status.network_loaded");
  state.lastResult = null;
  kpiInvalidate();
  cancelActiveCompute();
  // Keep geometry for the optional vector rendering, same cap as the gpkg path.
  // Keep per-way meta (bridge/tunnel/layer) aligned with the kept lines for
  // graph-mode bridge handling (Phase C).
  let vertices = 0;
  let kept = [];
  let keptMeta = meta ? [] : null;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    vertices += ln.length;
    if (vertices > 2_000_000) { kept = null; keptMeta = null; break; }
    kept.push(ln);
    if (keptMeta) keptMeta.push(meta[i] || null);
  }
  state.networkLines = kept;
  state.networkLinesMeta = keptMeta;
  applyNetworkLinesOverlay();
  syncLoadedHighlights(); // light up group 1B
  setGroupOpen("impassable-group", true); // network loaded → next input step
  onNetworkCorridorsChanged(); // a new network may carve corridors over the mask
  return true;
}

// Pull the street network (highway=*) from OpenStreetMap via the Overpass
// API, over the intersection of the current map view and the DEM extent.
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

async function loadOsmNetwork() {
  if (!state.dem) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.load_dem_first")}</span>`;
    return;
  }
  // OSM coords are lon/lat; the bbox intersection below only holds for a
  // geographic (EPSG:4326) DEM (mirrors the bridges/water OSM-pull guards).
  if (!state.dem.isGeographic) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.osm_net_geographic")}</span>`;
    return;
  }
  // Epoch token: state.dem is replaced wholesale on every DEM load, so
  // identity is a correct guard against installing this pull onto a DEM
  // that changed while the Overpass fetch/parse was in flight.
  const demRef = state.dem;
  const { originX, originY, H, W, dx, dy } = state.dem;
  const b = map.getBounds();
  const south = Math.max(b.getSouth(), originY - H * dy);
  const north = Math.min(b.getNorth(), originY);
  const west  = Math.max(b.getWest(),  originX);
  const east  = Math.min(b.getEast(),  originX + W * dx);
  if (!(south < north && west < east)) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.osm_no_intersect")}</span>`;
    return;
  }
  const osmBtn = document.getElementById("vec-osm");
  if (osmBtn) osmBtn.disabled = true;
  progress.classList.add("active");
  progressBar.style.width = "20%";
  status.textContent = t("status.osm_querying");
  try {
    // `out geom` inlines each way's coordinates — no separate node lookups.
    const query =
      `[out:json][timeout:90];way["highway"](${south.toFixed(6)},${west.toFixed(6)},${north.toFixed(6)},${east.toFixed(6)});out geom;`;
    const resp = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query),
    });
    if (!resp.ok) throw new Error(t("status.overpass_http", resp.status));
    progressBar.style.width = "60%";
    status.textContent = t("status.osm_parsing");
    const json = await resp.json();
    // A timed-out/OOM'd query still answers HTTP 200 with a `remark` field and
    // empty or PARTIAL elements — surface it as a failure BEFORE parsing any
    // elements, or a partial network pull installs an incomplete graph that
    // silently misses streets cut off by the timeout.
    if (json.remark) throw new Error(json.remark);
    const lines = [];
    const meta = []; // parallel { deck, layer } for graph-mode bridge handling
    const bridgeCandidates = []; // bridge/tunnel ways for the 1d "from network" feature
    for (const el of json.elements || []) {
      if (el.type === "way" && Array.isArray(el.geometry) && el.geometry.length > 1) {
        const latlngs = el.geometry.map((g) => [g.lat, g.lon]);
        lines.push(latlngs);
        const tg = el.tags || {};
        const deck = (tg.bridge && tg.bridge !== "no") || tg.tunnel === "yes";
        // 0-safe: an explicit layer=0 is a real value (|| would coerce it to
        // the default); missing/unparseable keeps the tunnel −1 / bridge 1.
        const layerParsed = parseInt(tg.layer, 10);
        const layer = Number.isFinite(layerParsed) ? layerParsed : (tg.tunnel === "yes" ? -1 : 1);
        meta.push(deck ? { deck: true, layer } : { deck: false, layer: 0 });
        if (deck) bridgeCandidates.push({ latlngs, kind: tg.tunnel === "yes" ? "tunnel" : "bridge", layer, name: tg["bridge:name"] || tg.name || null });
      }
    }
    if (!lines.length) throw new Error(t("status.osm_no_ways"));
    if (state.dem !== demRef) {
      status.textContent = t("status.load_superseded");
      return;
    }
    state.networkBridgeCandidates = bridgeCandidates.length ? bridgeCandidates : null;
    progressBar.style.width = "80%";
    status.textContent = t("status.osm_rasterising", lines.length.toLocaleString());
    // Let the status paint before the synchronous rasterise.
    await new Promise((r) => setTimeout(r, 0));
    installNetworkFromLines(lines, 4326, "OSM highway=*", meta);
  } catch (err) {
    console.error("[osm]", err);
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.osm_failed", escapeHtml(err.message))}</span>`;
  } finally {
    progress.classList.remove("active");
    if (osmBtn) osmBtn.disabled = false;
  }
}

// Pull the same highway=* network from the South-America road FlatGeobuf
// (built by amora's build-viario.py from Geofabrik OSM, hosted on gs://telhas
// behind telhas.pedalhidrografi.co — CORS `*`). The FGB's packed Hilbert
// R-tree lets flatgeobuf.deserialize(url, rect) fetch ONLY the bytes inside
// the view∩DEM bbox via HTTP Range requests — no Overpass dependency, no
// server-side timeout, and bridge/tunnel/layer come as real columns (raw OSM
// values; normalized below exactly like the Overpass pull, so the two sources
// are interchangeable downstream). Reuses the flatgeobuf 3.36.0 the census
// sampling already loads, and the same installNetworkFromLines tail.
const VIARIO_FGB_URL = "https://telhas.pedalhidrografi.co/viario/south-america-viario.fgb";
const WATER_AREAS_FGB_URL  = "https://telhas.pedalhidrografi.co/viario/south-america-water-areas.fgb";
const WATER_RIVERS_FGB_URL = "https://telhas.pedalhidrografi.co/viario/south-america-water-rivers.fgb";
// Teto de janela dos pulls FGB = o MESMO teto do FABDEM (v71): a área em
// graus² que o cap de 50 MB do loader FABDEM permite (bytes ÷ 4 células ×
// (1″)² por célula ≈ 1,01°², ~100×110 km em SP). Derivado das constantes do
// FABDEM de propósito — mudar o cap de lá move este junto, e qualquer janela
// que o FABDEM aceita os pulls de viário/água/pontes aceitam também (um único
// "aproxime o zoom" pra todo o fluxo). Antes: viário/pontes 0,25°² e água
// 1,0°², dois tetos à mão que já tinham divergido.
const FGB_PULL_MAX_DEG2 = (FABDEM_MAX_BYTES / 4) * FABDEM_ARCSEC * FABDEM_ARCSEC;
const FGB_PULL_TIMEOUT_MS = 120_000;

// Stream de um FGB por bbox com timeout — a fetch órfã morre sozinha quando o
// generator é solto (deserialize não aceita AbortSignal). Uma cópia pros três
// pulls (viário, água, pontes).
async function fgbStream(url, rect, onFeature) {
  await Promise.race([
    (async () => { for await (const f of flatgeobuf.deserialize(url, rect)) onFeature(f); })(),
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), FGB_PULL_TIMEOUT_MS)),
  ]);
}

async function loadFgbNetwork() {
  if (!state.dem) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.load_dem_first")}</span>`;
    return;
  }
  // FGB coords are lon/lat; the bbox intersection below only holds for a
  // geographic (EPSG:4326) DEM (same guard as the Overpass pull).
  if (!state.dem.isGeographic) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.osm_net_geographic")}</span>`;
    return;
  }
  if (typeof flatgeobuf === "undefined") {
    status.innerHTML = `<span style="color:#ff6b6b">${t("census.lib_missing")}</span>`;
    return;
  }
  const demRef = state.dem;              // epoch token, same as loadOsmNetwork
  const { originX, originY, H, W, dx, dy } = state.dem;
  const b = map.getBounds();
  const south = Math.max(b.getSouth(), originY - H * dy);
  const north = Math.min(b.getNorth(), originY);
  const west  = Math.max(b.getWest(),  originX);
  const east  = Math.min(b.getEast(),  originX + W * dx);
  if (!(south < north && west < east)) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.osm_no_intersect")}</span>`;
    return;
  }
  // Soft cap: an accidental continental-zoom pull would stream a huge share
  // of the file. Overpass self-limits via its server timeout; here we refuse
  // politely with the window size in km. The cap is the FABDEM window cap
  // (derived from its constants) — any window FABDEM accepts, this accepts.
  if ((east - west) * (north - south) > FGB_PULL_MAX_DEG2) {
    const kmX = (east - west) * 111.32 * Math.cos(((south + north) / 2) * Math.PI / 180);
    const kmY = (north - south) * 111.32;
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.fgb_too_big", kmX.toFixed(0), kmY.toFixed(0))}</span>`;
    return;
  }
  const fgbBtn = document.getElementById("vec-fgb");
  if (fgbBtn) fgbBtn.disabled = true;
  progress.classList.add("active");
  progressBar.style.width = "20%";
  status.textContent = t("status.fgb_querying");
  try {
    const rect = { minX: west, minY: south, maxX: east, maxY: north };
    const lines = [];
    const meta = [];               // parallel { deck, layer }, as in the OSM pull
    const bridgeCandidates = [];
    const pushLine = (coords, p) => {
      if (!Array.isArray(coords) || coords.length < 2) return;
      const latlngs = coords.map((c) => [c[1], c[0]]);   // [lng,lat] → [lat,lng]
      lines.push(latlngs);
      // Same normalization as the Overpass pull (raw OSM values in columns).
      const deck = (p.bridge && p.bridge !== "no") || p.tunnel === "yes";
      const layerParsed = parseInt(p.layer, 10);
      const layer = Number.isFinite(layerParsed) ? layerParsed : (p.tunnel === "yes" ? -1 : 1);
      meta.push(deck ? { deck: true, layer } : { deck: false, layer: 0 });
      if (deck) bridgeCandidates.push({ latlngs, kind: p.tunnel === "yes" ? "tunnel" : "bridge", layer, name: null });
    };
    let n = 0;
    await fgbStream(VIARIO_FGB_URL, rect, (f) => {
      const g = f?.geometry;
      const p = f?.properties || {};
      if (g?.type === "LineString") pushLine(g.coordinates, p);
      else if (g?.type === "MultiLineString") for (const part of g.coordinates) pushLine(part, p);
      if (++n % 2048 === 0) {
        status.textContent = t("status.fgb_progress", n.toLocaleString());
        progressBar.style.width = `${Math.min(70, 20 + n / 400)}%`;
      }
    });
    if (!lines.length) throw new Error(t("status.fgb_no_ways"));
    if (state.dem !== demRef) {
      status.textContent = t("status.load_superseded");
      return;
    }
    state.networkBridgeCandidates = bridgeCandidates.length ? bridgeCandidates : null;
    progressBar.style.width = "80%";
    status.textContent = t("status.osm_rasterising", lines.length.toLocaleString());
    await new Promise((r) => setTimeout(r, 0));   // let the status paint
    installNetworkFromLines(lines, 4326, "FGB viário (América do Sul)", meta);
  } catch (err) {
    console.error("[fgb-net]", err);
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.fgb_failed", escapeHtml(err.message))}</span>`;
  } finally {
    progress.classList.remove("active");
    if (fgbBtn) fgbBtn.disabled = false;
  }
}

// ---- OSM bridges & tunnels (level decks → portal edges) -------------------
// Pull bridge/tunnel ways from OSM and model each as a level deck spanning its
// two ground abutments. A bare-earth DEM omits the deck, so routing over a
// viaduct otherwise dives into the valley below; the deck is the flat truth.
// In the raster compute each deck becomes a PORTAL EDGE between its end cells at
// the flat-deck cost, leaving the cells underneath untouched — so both the
// over-bridge and the under-bridge route stay correct (2.5-D safe).

function llToCell(lat, lng) {
  const { originX, originY, dx, dy } = state.dem;
  return [Math.floor((originY - lat) / dy), Math.floor((lng - originX) / dx)];
}

async function loadOsmBridges() {
  if (!state.dem) { status.innerHTML = `<span style="color:#ff6b6b">${t("status.load_dem_first")}</span>`; return; }
  // OSM coords are lon/lat; the cell mapping (llToCell) only holds for a
  // geographic (EPSG:4326) DEM. Refuse on a projected DEM rather than place
  // bridges on garbage cells (mirrors the map-click / ref-file guards).
  if (!state.dem.isGeographic) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("bridges.osm_need_geographic")}</span>`;
    return;
  }
  // Epoch token: guards the async install tail below against a DEM swap
  // that happens while the Overpass fetch/parse is in flight.
  const demRef = state.dem;
  const { originX, originY, H, W, dx, dy } = state.dem;
  const b = map.getBounds();
  const south = Math.max(b.getSouth(), originY - H * dy);
  const north = Math.min(b.getNorth(), originY);
  const west  = Math.max(b.getWest(),  originX);
  const east  = Math.min(b.getEast(),  originX + W * dx);
  if (!(south < north && west < east)) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.osm_no_intersect")}</span>`;
    return;
  }
  const withTunnels = !!document.getElementById("bridge-tunnels")?.checked;
  const btn = document.getElementById("bridge-osm");
  if (btn) btn.disabled = true;
  progress.classList.add("active");
  progressBar.style.width = "20%";
  status.textContent = t("status.osm_querying");
  try {
    const bbox = `${south.toFixed(6)},${west.toFixed(6)},${north.toFixed(6)},${east.toFixed(6)}`;
    const parts = [`way["bridge"]["bridge"!="no"]["highway"](${bbox});`];
    if (withTunnels) parts.push(`way["tunnel"="yes"]["highway"](${bbox});`);
    // Pull the ways' geometry AND any `ele` tags on their nodes (mapped deck
    // elevations): union → set .bw → emit geometry, then its nodes carrying ele.
    const query = `[out:json][timeout:90];(${parts.join("")})->.bw;.bw out geom;node(w.bw)["ele"];out body;`;
    const resp = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query),
    });
    if (!resp.ok) throw new Error(t("status.overpass_http", resp.status));
    progressBar.style.width = "60%";
    status.textContent = t("status.osm_parsing");
    const json = await resp.json();
    // Mapped node elevations (`ele`), keyed by rounded coord — matched to way
    // vertices by position (same OSM nodes ⇒ identical coords).
    const eleByCoord = new Map();
    const ckey = (lat, lon) => `${lat.toFixed(7)},${lon.toFixed(7)}`;
    for (const el of json.elements || []) {
      if (el.type !== "node" || !el.tags || el.tags.ele == null) continue;
      const e = parseFloat(el.tags.ele);
      if (Number.isFinite(e)) eleByCoord.set(ckey(el.lat, el.lon), e);
    }
    const ways = [];
    for (const el of json.elements || []) {
      if (el.type !== "way" || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
      const tg = el.tags || {};
      const g = el.geometry;
      // Deck elevation at each abutment (way end): the end node's `ele` if
      // mapped, else a way-level `ele`, else the nearest mapped node from that
      // end; null ⇒ buildPortals falls back to the DEM at the abutment cell.
      const vEle = g.map((p) => (eleByCoord.has(ckey(p.lat, p.lon)) ? eleByCoord.get(ckey(p.lat, p.lon)) : null));
      const wayEle = Number.isFinite(parseFloat(tg.ele)) ? parseFloat(tg.ele) : null;
      let firstTagged = null, lastTagged = null;
      for (let i = 0; i < vEle.length; i++) { if (vEle[i] != null) { firstTagged = vEle[i]; break; } }
      for (let i = vEle.length - 1; i >= 0; i--) { if (vEle[i] != null) { lastTagged = vEle[i]; break; } }
      ways.push({
        latlngs: g.map((p) => [p.lat, p.lon]),
        kind: tg.tunnel === "yes" ? "tunnel" : "bridge",
        layer: parseInt(tg.layer, 10) || 0,
        name: tg["bridge:name"] || tg.name || null,
        eleA: vEle[0] ?? wayEle ?? firstTagged ?? null,
        eleB: vEle[vEle.length - 1] ?? wayEle ?? lastTagged ?? null,
      });
    }
    if (!ways.length) throw new Error(t("bridges.none_overpass"));
    if (state.dem !== demRef) {
      status.textContent = t("status.load_superseded");
      return;
    }
    installBridgesFromWays(ways, "OSM");
  } catch (err) {
    console.error("[osm-bridges]", err);
    status.innerHTML = `<span style="color:#ff6b6b">${t("bridges.pull_failed", escapeHtml(err.message))}</span>`;
  } finally {
    progress.classList.remove("active");
    if (btn) btn.disabled = false;
  }
}

// Pull road bridges/tunnels from the viário FlatGeobuf instead of Overpass:
// the FGB carries the same OSM ways (osmium keeps the way splitting, so the
// first/last vertex are still the abutments) with bridge/tunnel/layer as
// columns. Two documented gaps vs the OSM pull: no mapped `ele` node
// elevations (eleA/eleB = null → buildPortals falls back to the DEM at the
// abutment cells) and highway-only coverage (railway decks absent). Same
// #bridge-tunnels checkbox semantics, same installBridgesFromWays tail.
async function loadFgbBridges() {
  if (!state.dem) { status.innerHTML = `<span style="color:#ff6b6b">${t("status.load_dem_first")}</span>`; return; }
  if (!state.dem.isGeographic) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("bridges.osm_need_geographic")}</span>`;
    return;
  }
  if (typeof flatgeobuf === "undefined") { status.innerHTML = `<span style="color:#ff6b6b">${t("census.lib_missing")}</span>`; return; }
  const demRef = state.dem;
  const { originX, originY, H, W, dx, dy } = state.dem;
  const b = map.getBounds();
  const south = Math.max(b.getSouth(), originY - H * dy);
  const north = Math.min(b.getNorth(), originY);
  const west  = Math.max(b.getWest(),  originX);
  const east  = Math.min(b.getEast(),  originX + W * dx);
  if (!(south < north && west < east)) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.osm_no_intersect")}</span>`;
    return;
  }
  if ((east - west) * (north - south) > FGB_PULL_MAX_DEG2) {
    const kmX = (east - west) * 111.32 * Math.cos(((south + north) / 2) * Math.PI / 180);
    const kmY = (north - south) * 111.32;
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.fgb_too_big", kmX.toFixed(0), kmY.toFixed(0))}</span>`;
    return;
  }
  const withTunnels = !!document.getElementById("bridge-tunnels")?.checked;
  const btn = document.getElementById("bridge-fgb");
  if (btn) btn.disabled = true;
  progress.classList.add("active");
  progressBar.style.width = "20%";
  status.textContent = t("status.fgb_querying");
  try {
    const rect = { minX: west, minY: south, maxX: east, maxY: north };
    const ways = [];
    const pushWay = (coords, p) => {
      if (!Array.isArray(coords) || coords.length < 2) return;
      ways.push({
        latlngs: coords.map((c) => [c[1], c[0]]),
        kind: p.tunnel === "yes" ? "tunnel" : "bridge",   // mesmo desempate do pull OSM
        layer: parseInt(p.layer, 10) || 0,
        name: null,
        eleA: null, eleB: null,                            // sem `ele` no FGB → DEM nos apoios
      });
    };
    let n = 0;
    await fgbStream(VIARIO_FGB_URL, rect, (f) => {
      const g = f?.geometry;
      const p = f?.properties || {};
      const isBridge = p.bridge && p.bridge !== "no";
      const isTunnel = p.tunnel === "yes";
      if (!isBridge && !(withTunnels && isTunnel)) return;
      if (g?.type === "LineString") pushWay(g.coordinates, p);
      else if (g?.type === "MultiLineString") for (const part of g.coordinates) pushWay(part, p);
      if (++n % 512 === 0) status.textContent = t("status.fgb_progress", n.toLocaleString());
    });
    if (!ways.length) throw new Error(t("bridges.none_fgb"));
    if (state.dem !== demRef) {
      status.textContent = t("status.load_superseded");
      return;
    }
    progressBar.style.width = "80%";
    installBridgesFromWays(ways, "FGB");
  } catch (err) {
    console.error("[fgb-bridges]", err);
    status.innerHTML = `<span style="color:#ff6b6b">${t("bridges.pull_failed", escapeHtml(err.message))}</span>`;
  } finally {
    progress.classList.remove("active");
    if (btn) btn.disabled = false;
  }
}

// Turn raw bridge/tunnel ways into the deck model (state.bridges). OSM splits a
// bridge way at its abutments, so the first/last vertex are the ground ends.
function installBridgesFromWays(ways, sourceLabel) {
  if (!state.dem.isGeographic) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("bridges.need_geographic")}</span>`;
    return false;
  }
  const { H, W, dxM, dyM, mask } = state.dem;
  const inB = (rc) => rc[0] >= 0 && rc[0] < H && rc[1] >= 0 && rc[1] < W;
  const bridges = [];
  let skipped = 0;
  for (const w of ways) {
    const pts = w.latlngs;
    const a = llToCell(pts[0][0], pts[0][1]);
    const z = llToCell(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    if (!inB(a) || !inB(z)) { skipped++; continue; }
    const endA = a[0] * W + a[1], endB = z[0] * W + z[1];
    // Need two distinct abutments with valid ground elevation to span a deck.
    if (endA === endB || !mask[endA] || !mask[endB]) { skipped++; continue; }
    let deckLenM = 0, prev = a;
    for (let i = 1; i < pts.length; i++) {
      const cur = llToCell(pts[i][0], pts[i][1]);
      deckLenM += Math.hypot((cur[0] - prev[0]) * dyM, (cur[1] - prev[1]) * dxM);
      prev = cur;
    }
    if (!(deckLenM > 0)) { skipped++; continue; }
    bridges.push({ latlngs: pts, endA, endB, deckLenM, kind: w.kind, layer: w.layer, name: w.name,
      eleA: Number.isFinite(w.eleA) ? w.eleA : null, eleB: Number.isFinite(w.eleB) ? w.eleB : null });
  }
  if (!bridges.length) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("bridges.none_usable", escapeHtml(sourceLabel))}</span>`;
    return false;
  }
  state.bridges = bridges;
  reappendDrawnPortals(); // this pull REPLACED state.bridges — keep drawn portals
  state.bridgesMeta = { source: sourceLabel, count: bridges.length, skipped };
  updateBridgeMeta();
  applyBridgeOverlay();
  markBridgesDirty(true);
  status.textContent = t("bridges.loaded", bridges.length);
  return true;
}

function clearBridges() {
  state.bridges = null;
  state.bridgesMeta = null;
  state.drawnPortals = []; // 1D "Clear bridges" also drops user-drawn portals
  if (state.bridgesLayer) { state.bridgesLayer.remove(); state.bridgesLayer = null; }
  updateBridgeMeta();
  if (typeof updateDrawMeta === "function") updateDrawMeta();
  markBridgesDirty(true);
}

function updateBridgeMeta() {
  const meta = document.getElementById("bridge-meta");
  if (!meta) return;
  if (!state.bridges) { meta.textContent = t("bridge.none"); syncLoadedHighlights(); return; }
  const m = state.bridgesMeta || {};
  let html = t("bridge.meta.count", String(state.bridges.length));
  if (m.skipped) html += `<br/>${t("bridge.meta.skipped", String(m.skipped))}`;
  meta.innerHTML = html;
  syncLoadedHighlights();
}

// Bridges change the RASTER routing (portal edges), so invalidate the compute
// + estimate. They do NOT affect the network-graph (graph mode is portal-blind;
// its bridge handling comes from the network's own tags, not state.bridges), so
// leave the cached graph alone — mirror markImpassableDirty otherwise.
function markBridgesDirty(reprobe = false) {
  cancelActiveCompute();
  state.lastResult = null;
  kpiInvalidate(); // portal edges change ref↔ref energies
  state.bridgesToken++;
  applyBridgeOverlay();
  if (reprobe && state.dem) {
    state.calibration = null;
    state.calibrationGen++;
    state.calibrationFailed = false;
    if (state.probeWorker) { state.probeWorker.terminate(); state.probeWorker = null; }
    startCalibrationProbe();
  }
  estimateRunTime();
  syncLoadedHighlights(); // 1D status (loaded/applied) may have changed
}

// ------- On-map drawing tools (Leaflet-Geoman) -------
// 1C: barrier polygons (force impassable) + passable-corridor polygons (force
//     passable) rasterise into state.drawn{Impassable,Passable}Mask, applied in
//     buildComputeGrid + effectivePassableAt — separate from the file/OSM mask.
// 1D: portal lines become bridge shortcuts (drawn:true) in state.bridges, so
//     buildPortals + applyBridgeOverlay pick them up like OSM bridges.
// All drawn geometry persists via collectConfig/applyConfig (config + bundle).
const DRAW_STYLE = {
  barrier:  { color: "#d6493e", weight: 2, fillColor: "#d6493e", fillOpacity: 0.25 },
  corridor: { color: "#3fb56a", weight: 2, fillColor: "#3fb56a", fillOpacity: 0.22 },
  portal:   { color: "#1f6fd0", weight: 3, dashArray: "5,5" },
};
let drawMode = null; // 'barrier' | 'corridor' | 'portal' while a draw is armed

function ensureDrawLayers() {
  if (!state.drawLayers) {
    // Dedicated pane ABOVE the data overlays (relief..routes live at z 401-406)
    // so drawn shapes stay visible AND clickable when a result/relief is shown —
    // in the default overlayPane (400) they'd sit behind the overlays. A canvas
    // renderer bound to the pane is needed because the map is preferCanvas.
    if (!map.getPane("drawnPane")) {
      const dp = map.createPane("drawnPane");
      dp.style.zIndex = 450;
      dp.style.cursor = "pointer"; // drawn shapes are click-to-delete
      state.drawnRenderer = L.canvas({ pane: "drawnPane", tolerance: 8 }); // near-click hits thin lines too
    }
    state.drawLayers = {
      barrier:  L.layerGroup().addTo(map),
      corridor: L.layerGroup().addTo(map),
      portal:   L.layerGroup().addTo(map),
    };
  }
  return state.drawLayers;
}

// Bind a popup with a "delete this shape" button to a drawn layer, and stop the
// click from also reaching the map (which would drop a source/reference point).
function bindDeletePopup(layer, onDelete) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "🗑 " + t("draw.delete_this");
  // Explicit high-contrast style — Leaflet's popup is white, so the app's
  // .secondary class (light text on transparent) would be invisible here.
  btn.style.cssText =
    "margin:0;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;" +
    "background:#d6493e;color:#fff;border:none;border-radius:4px;white-space:nowrap;";
  btn.addEventListener("click", () => { layer.closePopup(); onDelete(); });
  const wrap = document.createElement("div");
  wrap.style.textAlign = "center";
  wrap.appendChild(btn);
  layer.bindPopup(wrap);
  layer.on("click", (e) => L.DomEvent.stopPropagation(e)); // don't place a point too
}

// lat/lng polygon rings → DEM-grid Uint8Array (1 inside). null if no geo DEM.
function rasterizeRingsToMask(rings) {
  if (!state.dem || !state.dem.isGeographic || !rings || !rings.length) return null;
  const { W, H } = state.dem;
  const data = new Uint8Array(W * H);
  for (const ring of rings) fillRingsEvenOdd([ring.map(([lat, lng]) => llToGridFrac(lat, lng))], data, W, H);
  return data;
}

function rebuildDrawnMasks() {
  state.drawnImpassableMask = rasterizeRingsToMask(state.drawnImpassable);
  state.drawnPassableMask = rasterizeRingsToMask(state.drawnPassable);
  updateDrawMeta();
  markImpassableDirty(true); // mask changed → invalidate compute + reprobe
}

function updateDrawMeta() {
  const im = document.getElementById("draw-impassable-meta");
  if (im) im.textContent = t("draw.imp_meta", (state.drawnImpassable || []).length, (state.drawnPassable || []).length);
  const pm = document.getElementById("draw-portal-meta");
  if (pm) pm.textContent = t("draw.portal_meta", (state.drawnPortals || []).length);
  // Single chokepoint for every drawn-geometry change (create/delete/clear,
  // polygons + portals all route through here) → refresh 1C/1D green status.
  syncLoadedHighlights();
}

// Build a bridge object from a drawn portal polyline (mirrors the per-way logic
// of installBridgesFromWays). Returns null if the endpoints aren't usable.
function makePortalBridge(latlngs) {
  if (!state.dem || !state.dem.isGeographic || !latlngs || latlngs.length < 2) return null;
  const { H, W, dxM, dyM, mask } = state.dem;
  const inB = (rc) => rc[0] >= 0 && rc[0] < H && rc[1] >= 0 && rc[1] < W;
  const a = llToCell(latlngs[0][0], latlngs[0][1]);
  const z = llToCell(latlngs[latlngs.length - 1][0], latlngs[latlngs.length - 1][1]);
  if (!inB(a) || !inB(z)) return null;
  const endA = a[0] * W + a[1], endB = z[0] * W + z[1];
  if (endA === endB || !mask[endA] || !mask[endB]) return null;
  let deckLenM = 0, prev = a;
  for (let i = 1; i < latlngs.length; i++) {
    const cur = llToCell(latlngs[i][0], latlngs[i][1]);
    deckLenM += Math.hypot((cur[0] - prev[0]) * dyM, (cur[1] - prev[1]) * dxM);
    prev = cur;
  }
  if (!(deckLenM > 0)) return null;
  return { latlngs, endA, endB, deckLenM, kind: "bridge", layer: 0, name: "drawn", eleA: null, eleB: null, drawn: true };
}

// Re-append the user-drawn portals to state.bridges (called after any OSM/bundle
// pull that REPLACES state.bridges, so drawings survive).
function reappendDrawnPortals() {
  if (!state.drawnPortals || !state.drawnPortals.length) return;
  state.bridges = state.bridges || [];
  for (const p of state.drawnPortals) { const br = makePortalBridge(p.latlngs); if (br) state.bridges.push(br); }
}

// Toggle the "armed" highlight (+ aria-pressed) on the three draw buttons.
function clearDrawArmed() {
  for (const m of ["barrier", "corridor", "portal"]) {
    const b = document.getElementById("draw-" + m);
    if (b) { b.classList.remove("armed"); b.removeAttribute("aria-pressed"); }
  }
}
function startDraw(mode) {
  if (!state.dem || !state.dem.isGeographic) {
    status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(t("draw.need_dem"))}</span>`;
    return;
  }
  if (!map.pm) return;
  drawMode = mode;
  clearDrawArmed();
  const ab = document.getElementById("draw-" + mode);
  if (ab) { ab.classList.add("armed"); ab.setAttribute("aria-pressed", "true"); }
  const shape = mode === "portal" ? "Line" : "Polygon";
  map.pm.enableDraw(shape, { templineStyle: DRAW_STYLE[mode], hintlineStyle: DRAW_STYLE[mode], pathOptions: DRAW_STYLE[mode] });
  status.textContent = t("draw.drawing");
  if (window.innerWidth <= 860 && window.__simuDrawer) window.__simuDrawer.close();
}

// Render a barrier/corridor ring as a clickable polygon (delete popup wired to
// remove THIS ring from state + rebuild). Reused by draw + restore.
function addDrawnPolygon(mode, ring) {
  const key = mode === "barrier" ? "drawnImpassable" : "drawnPassable";
  const groups = ensureDrawLayers();
  const layer = L.polygon(ring, { ...DRAW_STYLE[mode], pane: "drawnPane", renderer: state.drawnRenderer }).addTo(groups[mode]);
  bindDeletePopup(layer, () => {
    state[key] = (state[key] || []).filter((r) => r !== ring);
    layer.remove();
    rebuildDrawnMasks();
    status.textContent = t("draw.cleared");
  });
  return layer;
}

// Render a drawn portal as a clickable polyline (delete popup removes THIS
// portal + its bridge). Drawn portals live in their own layer group;
// applyBridgeOverlay skips drawn bridges so they aren't double-drawn.
function addDrawnPortalLayer(entry) {
  const groups = ensureDrawLayers();
  const layer = L.polyline(entry.latlngs, { ...DRAW_STYLE.portal, pane: "drawnPane", renderer: state.drawnRenderer }).addTo(groups.portal);
  bindDeletePopup(layer, () => {
    state.drawnPortals = (state.drawnPortals || []).filter((p) => p !== entry);
    state.bridges = (state.bridges || []).filter((b) => !b.drawn);
    reappendDrawnPortals();
    layer.remove();
    applyBridgeOverlay();
    markBridgesDirty(true);
    updateDrawMeta();
    status.textContent = t("draw.cleared");
  });
  return layer;
}

function onDrawCreate(e) {
  const mode = drawMode;
  drawMode = null;
  clearDrawArmed();
  if (map.pm) map.pm.disableDraw();
  const layer = e.layer;
  if (!mode || !layer) { if (layer && layer.remove) layer.remove(); return; }
  const ll = layer.getLatLngs ? layer.getLatLngs() : null;
  if (layer.remove) layer.remove(); // drop Geoman's layer; we keep our own
  if (!ll) return;
  if (mode === "portal") {
    const pts = ll.map((p) => [p.lat, p.lng]);
    const br = makePortalBridge(pts);
    if (!br) { status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(t("draw.portal_invalid"))}</span>`; return; }
    state.drawnPortals = state.drawnPortals || [];
    const entry = { latlngs: pts };
    state.drawnPortals.push(entry);
    state.bridges = state.bridges || [];
    state.bridges.push(br);
    addDrawnPortalLayer(entry);
    markBridgesDirty(true);
    updateDrawMeta();
    status.textContent = t("draw.portal_added", state.drawnPortals.length);
  } else {
    const ring = (Array.isArray(ll[0]) ? ll[0] : ll).map((p) => [p.lat, p.lng]);
    if (ring.length < 3) return;
    const key = mode === "barrier" ? "drawnImpassable" : "drawnPassable";
    state[key] = state[key] || [];
    state[key].push(ring);
    addDrawnPolygon(mode, ring);
    rebuildDrawnMasks();
    status.textContent = t(mode === "barrier" ? "draw.barrier_added" : "draw.corridor_added", state[key].length);
  }
}

function clearDrawnImpassable() {
  state.drawnImpassable = [];
  state.drawnPassable = [];
  const layers = ensureDrawLayers();
  layers.barrier.clearLayers();
  layers.corridor.clearLayers();
  rebuildDrawnMasks();
  status.textContent = t("draw.cleared");
}

// Unified 1C eraser: clears the loaded/OSM mask AND any drawn barriers/corridors.
function clearImpassableAll() {
  clearImpassableMask();
  clearDrawnImpassable();
}

function clearDrawnPortals() {
  state.drawnPortals = [];
  state.bridges = (state.bridges || []).filter((b) => !b.drawn);
  ensureDrawLayers().portal.clearLayers();
  applyBridgeOverlay();
  markBridgesDirty(true);
  updateDrawMeta();
  status.textContent = t("draw.cleared");
}

// Re-create overlays + masks + portal bridges from restored state.drawn*
// (after a config import or bundle load).
function restoreDrawnGeometry() {
  const layers = ensureDrawLayers();
  layers.barrier.clearLayers();
  layers.corridor.clearLayers();
  layers.portal.clearLayers();
  for (const ring of state.drawnImpassable || []) addDrawnPolygon("barrier", ring);
  for (const ring of state.drawnPassable || []) addDrawnPolygon("corridor", ring);
  state.bridges = (state.bridges || []).filter((b) => !b.drawn);
  reappendDrawnPortals();
  for (const entry of state.drawnPortals || []) addDrawnPortalLayer(entry);
  state.drawnImpassableMask = rasterizeRingsToMask(state.drawnImpassable);
  state.drawnPassableMask = rasterizeRingsToMask(state.drawnPassable);
  updateDrawMeta();
  applyBridgeOverlay();
}

function setupDrawingTools() {
  document.getElementById("draw-barrier")?.addEventListener("click", () => startDraw("barrier"));
  document.getElementById("draw-corridor")?.addEventListener("click", () => startDraw("corridor"));
  document.getElementById("draw-portal")?.addEventListener("click", () => startDraw("portal"));
  // Esc cancels an armed draw (a mode-error escape hatch).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawMode) {
      drawMode = null;
      if (map.pm) map.pm.disableDraw();
      clearDrawArmed();
      status.textContent = t("draw.cleared");
    }
  });
  document.getElementById("draw-impassable-clear")?.addEventListener("click", clearImpassableAll);
  document.getElementById("draw-portal-clear")?.addEventListener("click", clearDrawnPortals);
  if (map.pm) map.on("pm:create", onDrawCreate);
  updateDrawMeta();
}

function bridgeOverlayOpacity() {
  const v = parseFloat(document.getElementById("bridge-opacity")?.value);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.9;
}

// Draw the decks as polylines (bridges orange, tunnels purple) on the network
// pane. Gated on the #bridge-show toggle + a geographic DEM.
function applyBridgeOverlay() {
  if (state.bridgesLayer) { state.bridgesLayer.remove(); state.bridgesLayer = null; }
  const show = !!document.getElementById("bridge-show")?.checked;
  if (!show || !state.dem || !state.dem.isGeographic || !state.bridges) return;
  const op = bridgeOverlayOpacity();
  const group = L.layerGroup();
  // Tolerant renderer so a click NEAR a deck (not exactly on the 3px line) hits it.
  const renderer = state.bridgeRenderer || (state.bridgeRenderer = L.canvas({ pane: "networkPane", tolerance: 8 }));
  for (const br of state.bridges) {
    if (br.drawn) continue; // user-drawn portals render in their own clickable group
    const poly = L.polyline(br.latlngs, {
      color: br.kind === "tunnel" ? "#a26bff" : "#ff7f0e",
      weight: 3, opacity: op, pane: "networkPane", interactive: true, renderer,
    }).addTo(group);
    // Click a loaded/OSM bridge or tunnel → delete it from the input dataset.
    bindDeletePopup(poly, () => {
      state.bridges = (state.bridges || []).filter((b) => b !== br);
      applyBridgeOverlay();
      markBridgesDirty(true);
      updateBridgeMeta();
      status.textContent = t("draw.cleared");
    });
  }
  group.addTo(map);
  state.bridgesLayer = group;
}

// Bridges → GeoJSON FeatureCollection (LineStrings, [lon,lat]) for the bundle.
function bridgesToFC(bridges) {
  return {
    type: "FeatureCollection",
    features: bridges.map((br) => ({
      type: "Feature",
      properties: { kind: br.kind, layer: br.layer, name: br.name || null,
        eleA: br.eleA ?? null, eleB: br.eleB ?? null },
      geometry: { type: "LineString", coordinates: br.latlngs.map(([lat, lng]) => [lng, lat]) },
    })),
  };
}

function clearVectorNetwork() {
  cancelActiveCompute(); // in-flight runs are constrained to the old network
  state.networkMask = null;
  state.networkSrsId = null;
  state.networkFeatureCount = 0;
  state.networkLines = null;
  state.networkLinesMeta = null;
  state.networkBridgeCandidates = null;
  if (state.networkLinesLayer) { state.networkLinesLayer.remove(); state.networkLinesLayer = null; }
  state.networkGraph = null; state.networkGraphToken = null;
  removeGraphLayers();
  state.lastGraphResult = null;
  state.graphEnergyRaster = null;
  const meta = document.getElementById("vec-meta");
  // Back to the empty state: translated text + restore data-i18n so a later
  // language toggle re-translates it (the live-load path removed the attribute).
  if (meta) { meta.textContent = t("net.no_network"); meta.setAttribute("data-i18n", "net.no_network"); }
  const inp = document.getElementById("vector-file");
  if (inp) inp.value = "";
  syncLoadedHighlights(); // group 1B no longer "loaded"
  // Corridors depend on the network — drop them, disable the toggle, recalibrate.
  onNetworkCorridorsChanged();
}

// ---- Optional impassable mask (water bodies, etc.) ------------------------
// Upload a binary GeoTIFF (1=impassable); it's resampled onto the DEM grid by
// area-coverage majority. The loaded vector network can carve bridge corridors
// across it, optionally with a smooth elevation offset. All composition happens
// in buildComputeGrid() — engines unchanged.

// Invalidate everything a loaded mask affects. reprobe re-runs the compute-time
// calibration (only on geometry changes — not on every offset keystroke).
function markImpassableDirty(reprobe = false) {
  cancelActiveCompute();      // an in-flight run used the previous grid
  state.lastResult = null;    // stale render
  kpiInvalidate();            // grid changes void the accessibility matrix
  state.impassableToken++;    // rebuild the cached network graph (heights/validity changed)
  state.networkGraph = null; state.networkGraphToken = null;
  applyImpassableOverlay();
  if (reprobe && state.dem) {
    state.calibration = null;
    state.calibrationGen++;
    state.calibrationFailed = false;
    if (state.probeWorker) { state.probeWorker.terminate(); state.probeWorker = null; }
    startCalibrationProbe();
  }
  estimateRunTime();
  syncLoadedHighlights(); // 1C status (loaded/applied) may have changed
}

// ---- OSM water → impassable mask (group 1c) ------------------------------
// Pull water from OSM and rasterise it onto the DEM grid as an impassable mask,
// reusing the uploaded-mask pipeline (applyImpassableRaster → Invert, corridors,
// overlay, bundle — the synthetic raster matches the DEM grid so resampling is
// identity). Impassable = water AREAS (natural=water / waterway=riverbank /
// landuse=reservoir, ways + multipolygon relations) and NON-tunnelled
// waterway=river LINES. Streams (never queried) and tunnelled/culverted rivers
// (filtered client-side) stay passable. OSM coords are lon/lat → geographic DEM
// only (mirrors the OSM bridge/network guards).

// Fractional grid coords [gx, gy] for a lat/lng (cell centres at integer+0.5,
// matching resampleMaskToDem's identity sampling on a grid-matched raster).
function llToGridFrac(lat, lng) {
  const { originX, originY, dx, dy } = state.dem;
  return [(lng - originX) / dx, (originY - lat) / dy];
}

// Even-odd scanline fill of a BODY's rings (each [[gx,gy],…]) into `out`
// (1=impassable). All rings of one body fill together, so inner rings (islands)
// cut holes by crossing parity. Clamped to the body's row span; edges/vertices
// outside the grid still contribute correct crossings (only the marks clip).
function fillRingsEvenOdd(rings, out, W, H) {
  let yMin = Infinity, yMax = -Infinity;
  for (const r of rings) for (const p of r) { if (p[1] < yMin) yMin = p[1]; if (p[1] > yMax) yMax = p[1]; }
  if (!Number.isFinite(yMin)) return;
  const r0 = Math.max(0, Math.floor(yMin)), r1 = Math.min(H - 1, Math.floor(yMax));
  const xs = [];
  for (let ry = r0; ry <= r1; ry++) {
    const yc = ry + 0.5;
    xs.length = 0;
    for (const ring of rings) {
      const n = ring.length;
      if (n < 3) continue;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = ring[i][1], yj = ring[j][1];
        if ((yi > yc) !== (yj > yc)) xs.push(ring[i][0] + (yc - yi) / (yj - yi) * (ring[j][0] - ring[i][0]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const base = ry * W;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const cA = Math.max(0, Math.ceil(xs[k] - 0.5));
      const cB = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let c = cA; c <= cB; c++) out[base + c] = 1;
    }
  }
}

// Supercover (4-connected) rasterisation of a polyline — every cell the line
// crosses (Amanatides–Woo), so an 8-connected route can't slip across it.
function rasterPolylineSupercover(pts, out, W, H) {
  const mark = (cx, cy) => { if (cx >= 0 && cx < W && cy >= 0 && cy < H) out[cy * W + cx] = 1; };
  for (let s = 0; s + 1 < pts.length; s++) {
    const x0 = pts[s][0], y0 = pts[s][1], x1 = pts[s + 1][0], y1 = pts[s + 1][1];
    const dX = x1 - x0, dY = y1 - y0;
    let ix = Math.floor(x0), iy = Math.floor(y0);
    const ixe = Math.floor(x1), iye = Math.floor(y1);
    const stepX = dX > 0 ? 1 : (dX < 0 ? -1 : 0);
    const stepY = dY > 0 ? 1 : (dY < 0 ? -1 : 0);
    const tdX = dX !== 0 ? Math.abs(1 / dX) : Infinity;
    const tdY = dY !== 0 ? Math.abs(1 / dY) : Infinity;
    let tmX = dX !== 0 ? ((stepX > 0 ? ix + 1 : ix) - x0) / dX : Infinity;
    let tmY = dY !== 0 ? ((stepY > 0 ? iy + 1 : iy) - y0) / dY : Infinity;
    mark(ix, iy);
    let guard = Math.abs(ixe - ix) + Math.abs(iye - iy) + 4;
    while ((ix !== ixe || iy !== iye) && guard-- > 0) {
      if (tmX < tmY) { tmX += tdX; ix += stepX; } else { tmY += tdY; iy += stepY; }
      mark(ix, iy);
    }
  }
}

// Stitch open polyline segments (relation members) into closed rings by matching
// endpoints. Already-closed members pass through; even-odd fill wraps the rest.
function assembleRings(segments) {
  const tol = 1e-7;
  const near = (a, b) => Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol;
  const rings = [], open = [];
  for (const s of segments) {
    if (s.length >= 3 && near(s[0], s[s.length - 1])) rings.push(s);
    else if (s.length >= 2) open.push(s.slice());
  }
  while (open.length) {
    let chain = open.pop();
    let grew = true;
    while (grew && !near(chain[0], chain[chain.length - 1])) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const s = open[i], head = chain[0], tail = chain[chain.length - 1];
        if (near(tail, s[0]))               chain = chain.concat(s.slice(1));
        else if (near(tail, s[s.length - 1])) chain = chain.concat(s.slice().reverse().slice(1));
        else if (near(head, s[s.length - 1])) chain = s.slice(0, -1).concat(chain);
        else if (near(head, s[0]))          chain = s.slice().reverse().slice(0, -1).concat(chain);
        else continue;
        open.splice(i, 1); grew = true; break;
      }
    }
    // Only emit a CLOSED ring — an unclosed leftover (broken/truncated relation,
    // or a member without geometry) is not a valid area boundary; filling it
    // would fabricate a phantom closing edge and over-mark cells.
    if (chain.length >= 3 && near(chain[0], chain[chain.length - 1])) rings.push(chain);
  }
  return rings;
}

// The open sea/ocean is NOT a fillable polygon in OSM — it's implied by
// natural=coastline ways (directed so LAND is on the LEFT, WATER on the RIGHT).
// Real coastline data has open ends and gaps (river mouths, bbox edges), so a
// flood-fill leaks catastrophically. Instead, fill the sea with orientation
// SWEEPS: each crossing SETS the sea/land state on one side from the crossing's
// travel direction. State is SET locally per span (not toggled), so a missing/
// extra crossing corrupts at most one span instead of cascading. A single sweep
// is blind to coast PARALLEL to it (a N–S scanline can't see an E–W beach), so
// we run BOTH a horizontal and a vertical sweep and UNION them — each resolves
// the coast perpendicular to it (H → bays, V → open ocean). The shore is stamped
// impassable too. Pure over grid coords (unit-tested).
function fillSeaFromCoastlines(coastlines, data, W, H) {
  if (!coastlines || !coastlines.length) return 0;
  for (const line of coastlines) rasterPolylineSupercover(line, data, W, H); // shore = impassable edge
  const xs = []; // crossings of the current scan: { p = position along scan, sea = state past it }
  // Horizontal sweep: per ROW, a crossing sets the state to its EAST
  // (north-going coast, grid y decreasing → sea to the east).
  for (let ry = 0; ry < H; ry++) {
    const yc = ry + 0.5;
    xs.length = 0;
    for (const line of coastlines) for (let i = 0; i + 1 < line.length; i++) {
      const y0 = line[i][1], y1 = line[i + 1][1];
      if ((y0 > yc) !== (y1 > yc)) { const x0 = line[i][0], x1 = line[i + 1][0];
        xs.push({ p: x0 + (yc - y0) / (y1 - y0) * (x1 - x0), sea: y1 < y0 }); }
    }
    if (!xs.length) continue;
    xs.sort((a, b) => a.p - b.p);
    const base = ry * W;
    let k = -1;
    for (let c = 0; c < W; c++) {
      const cx = c + 0.5;
      while (k + 1 < xs.length && xs[k + 1].p <= cx) k++;
      if (k >= 0 ? xs[k].sea : !xs[0].sea) data[base + c] = 1;
    }
  }
  // Vertical sweep: per COLUMN, a crossing sets the state to its SOUTH
  // (east-going coast, x increasing → sea to the south).
  for (let cx = 0; cx < W; cx++) {
    const xc = cx + 0.5;
    xs.length = 0;
    for (const line of coastlines) for (let i = 0; i + 1 < line.length; i++) {
      const x0 = line[i][0], x1 = line[i + 1][0];
      if ((x0 > xc) !== (x1 > xc)) { const y0 = line[i][1], y1 = line[i + 1][1];
        xs.push({ p: y0 + (xc - x0) / (x1 - x0) * (y1 - y0), sea: x1 > x0 }); }
    }
    if (!xs.length) continue;
    xs.sort((a, b) => a.p - b.p);
    let k = -1;
    for (let r = 0; r < H; r++) {
      const cy = r + 0.5;
      while (k + 1 < xs.length && xs[k + 1].p <= cy) k++;
      if (k >= 0 ? xs[k].sea : !xs[0].sea) data[r * W + cx] = 1;
    }
  }
  let filled = 0; for (let i = 0, N = W * H; i < N; i++) if (data[i]) filled++;
  return filled;
}

// Async, chunked re-implementations of fillRingsEvenOdd/fillSeaFromCoastlines
// for the main-thread caller (rebuildOsmWaterMask): SAME per-row/per-sweep math
// as the pure functions above, just batched with a TIME-based yield so a
// single huge body (a reservoir ring with tens of thousands of vertices) or
// the coastline sweep doesn't block the tab end-to-end. The pure functions
// themselves are left untouched — they're hand-mirrored in
// test-water-raster.mjs (same rule as the Rust backend port) and still used
// directly by rasterizeRingsToMask (drawn-shape masks, small and synchronous)
// and the rivers loop below. A fixed item count (e.g. "every 25 bodies") would
// miss the actual cost concentration — a 10-vertex pond and a 30,000-vertex
// reservoir ring differ by orders of magnitude — so the yield cadence here is
// wall-clock based instead.
const WATER_MASK_YIELD_MS = 50;

async function fillRingsEvenOddChunked(rings, out, W, H) {
  let yMin = Infinity, yMax = -Infinity;
  for (const r of rings) for (const p of r) { if (p[1] < yMin) yMin = p[1]; if (p[1] > yMax) yMax = p[1]; }
  if (!Number.isFinite(yMin)) return;
  const r0 = Math.max(0, Math.floor(yMin)), r1 = Math.min(H - 1, Math.floor(yMax));
  const xs = [];
  let lastYield = performance.now();
  for (let ry = r0; ry <= r1; ry++) {
    const yc = ry + 0.5;
    xs.length = 0;
    for (const ring of rings) {
      const n = ring.length;
      if (n < 3) continue;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = ring[i][1], yj = ring[j][1];
        if ((yi > yc) !== (yj > yc)) xs.push(ring[i][0] + (yc - yi) / (yj - yi) * (ring[j][0] - ring[i][0]));
      }
    }
    if (xs.length >= 2) {
      xs.sort((a, b) => a - b);
      const base = ry * W;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const cA = Math.max(0, Math.ceil(xs[k] - 0.5));
        const cB = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
        for (let c = cA; c <= cB; c++) out[base + c] = 1;
      }
    }
    if (performance.now() - lastYield > WATER_MASK_YIELD_MS) {
      await new Promise((res) => setTimeout(res, 0));
      lastYield = performance.now();
    }
  }
}

async function fillSeaFromCoastlinesChunked(coastlines, data, W, H) {
  if (!coastlines || !coastlines.length) return 0;
  let lastYield = performance.now();
  const maybeYield = async () => {
    if (performance.now() - lastYield > WATER_MASK_YIELD_MS) {
      await new Promise((res) => setTimeout(res, 0));
      lastYield = performance.now();
    }
  };
  for (const line of coastlines) { rasterPolylineSupercover(line, data, W, H); await maybeYield(); } // shore = impassable edge
  const xs = []; // crossings of the current scan: { p = position along scan, sea = state past it }
  // Horizontal sweep: per ROW, a crossing sets the state to its EAST
  // (north-going coast, grid y decreasing → sea to the east).
  for (let ry = 0; ry < H; ry++) {
    const yc = ry + 0.5;
    xs.length = 0;
    for (const line of coastlines) for (let i = 0; i + 1 < line.length; i++) {
      const y0 = line[i][1], y1 = line[i + 1][1];
      if ((y0 > yc) !== (y1 > yc)) { const x0 = line[i][0], x1 = line[i + 1][0];
        xs.push({ p: x0 + (yc - y0) / (y1 - y0) * (x1 - x0), sea: y1 < y0 }); }
    }
    if (xs.length) {
      xs.sort((a, b) => a.p - b.p);
      const base = ry * W;
      let k = -1;
      for (let c = 0; c < W; c++) {
        const cx = c + 0.5;
        while (k + 1 < xs.length && xs[k + 1].p <= cx) k++;
        if (k >= 0 ? xs[k].sea : !xs[0].sea) data[base + c] = 1;
      }
    }
    await maybeYield();
  }
  // Vertical sweep: per COLUMN, a crossing sets the state to its SOUTH
  // (east-going coast, x increasing → sea to the south).
  for (let cx = 0; cx < W; cx++) {
    const xc = cx + 0.5;
    xs.length = 0;
    for (const line of coastlines) for (let i = 0; i + 1 < line.length; i++) {
      const x0 = line[i][0], x1 = line[i + 1][0];
      if ((x0 > xc) !== (x1 > xc)) { const y0 = line[i][1], y1 = line[i + 1][1];
        xs.push({ p: y0 + (xc - x0) / (x1 - x0) * (y1 - y0), sea: x1 > x0 }); }
    }
    if (xs.length) {
      xs.sort((a, b) => a.p - b.p);
      let k = -1;
      for (let r = 0; r < H; r++) {
        const cy = r + 0.5;
        while (k + 1 < xs.length && xs[k + 1].p <= cy) k++;
        if (k >= 0 ? xs[k].sea : !xs[0].sea) data[r * W + cx] = 1;
      }
    }
    await maybeYield();
  }
  let filled = 0; for (let i = 0, N = W * H; i < N; i++) if (data[i]) filled++;
  return filled;
}

// Whether river LINES count as impassable (the #imp-rivers toggle). Water areas
// and the coastline-derived sea are ALWAYS impassable; only the river-line layer
// is optional. Default true.
function riversImpassable() { return document.getElementById("imp-rivers")?.checked ?? true; }

// (Re)rasterise the cached OSM water geometry onto the DEM grid and feed it to
// the uploaded-mask pipeline. Re-callable so the #imp-rivers toggle re-applies
// without re-querying Overpass. Areas (even-odd fill) + sea (coastline flood)
// always; river lines (supercover) only when the toggle is on. Async and
// chunked (see fillRingsEvenOddChunked/fillSeaFromCoastlinesChunked above) so a
// large water pull doesn't freeze the tab. Double-guarded like every other OSM
// loader: `demRef` (state.dem IDENTITY, not state.calibrationGen — that counter
// also bumps on unrelated markBridgesDirty(true)/markImpassableDirty(true)
// toggles, which must NOT abort an in-flight water rebuild) catches a DEM swap
// mid-rebuild, and state.waterMaskGen catches a SECOND rebuildOsmWaterMask call
// starting before this one finishes (rapid #imp-rivers toggling) — only the
// LAST-started call may apply its result.
async function rebuildOsmWaterMask() {
  const demRef = state.dem;
  const g = state.osmWaterGeom;
  if (!g || !state.dem || !state.dem.isGeographic) return;
  const myGen = ++state.waterMaskGen;
  const stale = () => state.dem !== demRef || myGen !== state.waterMaskGen;
  const { originX, originY, H, W, dx, dy } = state.dem;
  const data = new Uint8Array(W * H);
  const total = g.bodies.length + g.rivers.length + g.coastlines.length;
  progress.classList.add("active");
  progressBar.style.width = "0%";
  status.textContent = t("status.water_rasterising", total.toLocaleString());
  for (let bi = 0; bi < g.bodies.length; bi++) {
    await fillRingsEvenOddChunked(g.bodies[bi].rings, data, W, H);
    if (stale()) { progress.classList.remove("active"); status.textContent = t("status.load_superseded"); return; }
    progressBar.style.width = `${(((bi + 1) / Math.max(1, g.bodies.length)) * 50).toFixed(1)}%`;
  }
  if (riversImpassable()) {
    let lastYield = performance.now();
    for (let ri = 0; ri < g.rivers.length; ri++) {
      rasterPolylineSupercover(g.rivers[ri], data, W, H);
      if (performance.now() - lastYield > WATER_MASK_YIELD_MS) {
        await new Promise((r) => setTimeout(r, 0));
        lastYield = performance.now();
        if (stale()) { progress.classList.remove("active"); status.textContent = t("status.load_superseded"); return; }
        progressBar.style.width = `${(50 + ((ri + 1) / Math.max(1, g.rivers.length)) * 25).toFixed(1)}%`;
      }
    }
  }
  progressBar.style.width = "75%";
  await fillSeaFromCoastlinesChunked(g.coastlines, data, W, H);
  if (stale()) { progress.classList.remove("active"); status.textContent = t("status.load_superseded"); return; }
  progressBar.style.width = "100%";
  let cells = 0; for (let i = 0; i < data.length; i++) if (data[i]) cells++;
  // OSM water has a fixed polarity (water = impassable), so clear a stale Invert
  // from a prior uploaded raster before applying the canonical mask.
  const inv = document.getElementById("impassable-invert"); if (inv) inv.checked = false;
  const fi = document.getElementById("impassable-file"); if (fi) fi.value = "";
  // Wrap as a DEM-grid raster so the uploaded-mask pipeline consumes it
  // unchanged (resample is identity; Invert/corridors/overlay/bundle reused).
  applyImpassableRaster({ width: W, height: H, data, dx, dy, originX, originY, epsg: 4326 }, g.label || "OSM water");
  status.textContent = cells ? t("status.water_done", cells.toLocaleString()) : t("status.water_none");
  progress.classList.remove("active");
}

async function loadOsmWater() {
  if (!state.dem) { status.innerHTML = `<span style="color:#ff6b6b">${t("status.load_dem_first")}</span>`; return; }
  if (!state.dem.isGeographic) { status.innerHTML = `<span style="color:#ff6b6b">${t("status.water_geographic")}</span>`; return; }
  // Epoch token: guards the async install tail below against a DEM swap
  // that happens while the Overpass fetch/parse is in flight.
  const demRef = state.dem;
  const { originX, originY, H, W, dx, dy } = state.dem;
  // Full DEM extent — a mask should cover the whole grid, not just the view.
  const south = originY - H * dy, north = originY, west = originX, east = originX + W * dx;
  const btn = document.getElementById("impassable-osm");
  if (btn) btn.disabled = true;
  progress.classList.add("active");
  progressBar.style.width = "20%";
  status.textContent = t("status.water_querying");
  try {
    const bbox = `${south.toFixed(6)},${west.toFixed(6)},${north.toFixed(6)},${east.toFixed(6)}`;
    const query = `[out:json][timeout:120];(` +
      `way["natural"="water"](${bbox});relation["natural"="water"](${bbox});` +
      `way["waterway"="riverbank"](${bbox});relation["waterway"="riverbank"](${bbox});` +
      `way["landuse"="reservoir"](${bbox});relation["landuse"="reservoir"](${bbox});` +
      `way["natural"="coastline"](${bbox});` +     // the open sea: directed line, water on the right
      `way["waterway"="river"](${bbox});` +        // streams/canals/ditches intentionally NOT queried
      `);out geom;`;
    const resp = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query),
    });
    if (!resp.ok) throw new Error(t("status.overpass_http", resp.status));
    progressBar.style.width = "55%";
    status.textContent = t("status.water_parsing");
    const json = await resp.json();
    // A timed-out/OOM'd query still answers HTTP 200 with a `remark` field and
    // empty or PARTIAL elements — surface it as a failure BEFORE parsing any
    // elements, or a partial water pull installs an incomplete impassable mask
    // that silently lets routes cross rivers/lakes cut off by the timeout.
    if (json.remark) throw new Error(json.remark);
    const toGrid = (g) => llToGridFrac(g.lat, g.lon);
    const bodies = [];     // area bodies: { rings: [[[gx,gy],…], …] }
    const rivers = [];     // non-tunnelled river polylines: [[[gx,gy],…], …]
    const coastlines = []; // coastline polylines (sea = right side): [[[gx,gy],…], …]
    for (const el of json.elements || []) {
      const tg = el.tags || {};
      if (el.type === "way" && Array.isArray(el.geometry) && el.geometry.length >= 2) {
        if (tg.natural === "coastline") coastlines.push(el.geometry.map(toGrid));
        else if (tg.waterway === "river") { if (!tg.tunnel || tg.tunnel === "no") rivers.push(el.geometry.map(toGrid)); } // tunnelled = passable
        else bodies.push({ rings: [el.geometry.map(toGrid)] }); // closed water-area way (even-odd wraps it)
      } else if (el.type === "relation" && Array.isArray(el.members)) {
        const segs = [];
        for (const m of el.members) if (Array.isArray(m.geometry) && m.geometry.length >= 2) segs.push(m.geometry.map(toGrid));
        if (segs.length) bodies.push({ rings: assembleRings(segs) });
      }
    }
    if (!bodies.length && !rivers.length && !coastlines.length) {
      status.textContent = t("status.water_none"); // a normal "nothing here" result, not an error
      return;
    }
    progressBar.style.width = "75%";
    status.textContent = t("status.water_rasterising", (bodies.length + rivers.length + coastlines.length).toLocaleString());
    await new Promise((r) => setTimeout(r, 0)); // let the status paint before the (now chunked, async) rasterise below
    if (state.dem !== demRef) {
      status.textContent = t("status.load_superseded");
      return;
    }
    state.osmWaterGeom = { bodies, rivers, coastlines }; // cache so the #imp-rivers toggle re-applies without re-querying
    await rebuildOsmWaterMask();
  } catch (err) {
    console.error("[osm-water]", err);
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.water_failed", escapeHtml(err.message))}</span>`;
  } finally {
    progress.classList.remove("active");
    if (btn) btn.disabled = false;
  }
}

// Pull the water mask from the project's water FlatGeobufs (amora's
// build-viario.py --water on gs://telhas): areas (natural=water /
// landuse=reservoir / waterway=riverbank polygons) + waterway=river lines —
// the same feature classes as the Overpass pull, minus two documented gaps:
// NO coastline layer (the open sea is not filled — use the OSM pull on
// coastal DEMs) and no tunnel tag on rivers (tunnelled rivers stay blocked,
// a tiny over-block the Overpass pull filters out). Fills the SAME
// state.osmWaterGeom cache and reuses rebuildOsmWaterMask(), so the
// #imp-rivers toggle re-applies without re-querying, exactly like OSM.
async function loadFgbWater() {
  if (!state.dem) { status.innerHTML = `<span style="color:#ff6b6b">${t("status.load_dem_first")}</span>`; return; }
  if (!state.dem.isGeographic) { status.innerHTML = `<span style="color:#ff6b6b">${t("status.water_geographic")}</span>`; return; }
  if (typeof flatgeobuf === "undefined") { status.innerHTML = `<span style="color:#ff6b6b">${t("census.lib_missing")}</span>`; return; }
  const demRef = state.dem;
  const { originX, originY, H, W, dx, dy } = state.dem;
  // Full DEM extent — a mask should cover the whole grid (same as the OSM pull).
  const south = originY - H * dy, north = originY, west = originX, east = originX + W * dx;
  if ((east - west) * (north - south) > FGB_PULL_MAX_DEG2) {
    const kmX = (east - west) * 111.32 * Math.cos(((south + north) / 2) * Math.PI / 180);
    const kmY = (north - south) * 111.32;
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.fgb_too_big", kmX.toFixed(0), kmY.toFixed(0))}</span>`;
    return;
  }
  const btn = document.getElementById("impassable-fgb");
  if (btn) btn.disabled = true;
  progress.classList.add("active");
  progressBar.style.width = "10%";
  status.textContent = t("status.fgb_querying");
  try {
    const rect = { minX: west, minY: south, maxX: east, maxY: north };
    const toGrid = (c) => llToGridFrac(c[1], c[0]);          // [lng,lat] GeoJSON
    const bodies = [];
    const rivers = [];
    // Áreas: cada polígono (anéis externo+furos) é UM corpo — o preenchimento
    // even-odd de rebuildOsmWaterMask corta os furos por paridade.
    await fgbStream(WATER_AREAS_FGB_URL, rect, (f) => {
      const g = f?.geometry;
      if (g?.type === "Polygon") bodies.push({ rings: g.coordinates.map((r) => r.map(toGrid)) });
      else if (g?.type === "MultiPolygon") for (const poly of g.coordinates) bodies.push({ rings: poly.map((r) => r.map(toGrid)) });
    });
    progressBar.style.width = "45%";
    await fgbStream(WATER_RIVERS_FGB_URL, rect, (f) => {
      const g = f?.geometry;
      if (g?.type === "LineString") rivers.push(g.coordinates.map(toGrid));
      else if (g?.type === "MultiLineString") for (const part of g.coordinates) rivers.push(part.map(toGrid));
    });
    if (!bodies.length && !rivers.length) {
      status.textContent = t("status.water_none");
      return;
    }
    if (state.dem !== demRef) {
      status.textContent = t("status.load_superseded");
      return;
    }
    state.osmWaterGeom = { bodies, rivers, coastlines: [], label: "FGB água" };
    await rebuildOsmWaterMask();
  } catch (err) {
    console.error("[fgb-water]", err);
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.water_failed", escapeHtml(err.message))}</span>`;
  } finally {
    progress.classList.remove("active");
    if (btn) btn.disabled = false;
  }
}

async function loadImpassableMaskFromFile(file) {
  if (!state.dem) { status.innerHTML = `<span style="color:#ff6b6b">${t("status.load_dem_first")}</span>`; return; }
  const meta = document.getElementById("imp-meta");
  try {
    if (meta) meta.textContent = `Reading ${file.name}…`;
    const buf = await readFileWithProgress(file, () => {});
    const raster = await readMaskGeoTIFF(buf);
    // A file upload supersedes any cached OSM water pull as the mask source —
    // otherwise a later #imp-rivers toggle would silently re-rasterise the
    // stale OSM geometry over this upload (mirrors clearImpassableMask).
    state.osmWaterGeom = null;
    applyImpassableRaster(raster, file.name);
  } catch (err) {
    console.error("[impassable]", err);
    if (meta) meta.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(err.message)}</span>`;
  }
}

// (Re)resample the cached source raster onto the DEM grid with the current
// Invert setting, refresh derived state, and invalidate. Re-callable so the
// Invert toggle doesn't require a re-upload.
function applyImpassableRaster(raster, name) {
  if (!raster || !state.dem) return;
  state.impassableRaster = raster;
  const invert = !!document.getElementById("impassable-invert")?.checked;
  const imp = resampleMaskToDem(raster, state.dem, { invert });
  let cells = 0;
  for (let i = 0; i < imp.length; i++) if (imp[i]) cells++;
  state.impassable = imp;
  state.impassableMeta = {
    name: name ?? state.impassableMeta?.name ?? "mask",
    width: raster.width, height: raster.height, srs: raster.epsg, cellsImpassable: cells,
  };
  recomputeCorridors();
  updateImpassableMeta();
  updateCorridorAvailability();
  markImpassableDirty(true);
  setGroupOpen("bridges-group", true); // mask loaded → next input step
}

function updateImpassableMeta() {
  const meta = document.getElementById("imp-meta");
  if (!meta) return;
  if (!state.impassable) { meta.textContent = t("imp.none"); syncLoadedHighlights(); return; }
  const m = state.impassableMeta || {};
  const N = state.dem ? state.dem.H * state.dem.W : 0;
  const pct = N ? (100 * (m.cellsImpassable || 0) / N).toFixed(1) : "0";
  const corr = state.corridorCells ? state.corridorCells.length : 0;
  let html = `${escapeHtml(m.name || "mask")} · ` +
    t("imp.meta.cells", (m.cellsImpassable || 0).toLocaleString(), pct);
  if (corr) html += `<br/>${t("imp.meta.corridor", corr.toLocaleString())}`;
  meta.innerHTML = html;
  syncLoadedHighlights();
}

function clearImpassableMask() {
  state.impassable = null;
  state.impassableRaster = null;
  state.impassableMeta = null;
  state.corridorCells = null; state.corridorBase = null; state.corridorRamp = null;
  state.corridorSet = null;
  state.osmWaterGeom = null; // forget the cached OSM water geometry too
  const inp = document.getElementById("impassable-file");
  if (inp) inp.value = "";
  updateImpassableMeta();
  updateCorridorAvailability();
  markImpassableDirty(true);
}

// Enable the "carve corridors" toggle only when a network is loaded.
function updateCorridorAvailability() {
  const cb = document.getElementById("imp-corridor");
  const row = document.getElementById("imp-corridor-row");
  const hasNet = !!state.networkMask;
  if (cb) cb.disabled = !hasNet;
  if (row) row.style.opacity = hasNet ? "1" : "0.55";
}

// A network load/clear can add/remove bridge corridors, changing the effective
// compute grid. Recompute them, refresh the toggle, and — when a mask is present
// so the grid actually changed — fully invalidate (overlay + graph token +
// recalibration + estimate) via markImpassableDirty, exactly like a mask change.
// Enable the "extract bridges from loaded network" button only when the loaded
// network actually carries bridge/tunnel-tagged ways.
function updateBridgeNetworkButton() {
  const btn = document.getElementById("bridge-from-network");
  if (btn) btn.disabled = !(state.networkBridgeCandidates && state.networkBridgeCandidates.length);
}

function onNetworkCorridorsChanged() {
  recomputeCorridors();
  updateCorridorAvailability();
  updateBridgeNetworkButton();
  if (state.impassable) {
    markImpassableDirty(true); // overlay + token bump + graph invalidation + reprobe + estimate
  } else {
    applyImpassableOverlay();
    state.impassableToken++;
  }
}

// ---- Optional vector-network rendering (black lines, fixed ground width) --
// Leaflet polyline weights are in CSS pixels, so a fixed ground width needs
// a per-zoom conversion: metres per CSS pixel in Web Mercator at zoom z is
// 156543.03 · cos(lat) / 2^z. Re-applied on zoomend and on width/opacity
// input changes (live setStyle on the existing layers — no rebuild).

function networkLineWidthM() {
  const v = parseFloat(document.getElementById("vec-render-width")?.value);
  return Number.isFinite(v) && v > 0 ? v : 4;
}

function networkLineOpacity() {
  const v = parseFloat(document.getElementById("vec-render-opacity")?.value);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}

function networkLineWeightPx() {
  const zoom = map.getZoom();
  const lat = map.getCenter().lat;
  const mPerPx = 156543.03392 * Math.abs(Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  // Floor at 0.75 px so the network stays visible when zoomed far out.
  return Math.max(0.75, networkLineWidthM() / mPerPx);
}

function applyNetworkLinesOverlay() {
  if (state.networkLinesLayer) { state.networkLinesLayer.remove(); state.networkLinesLayer = null; }
  const on = !!document.getElementById("vec-render")?.checked;
  if (!on) return;
  if (!state.networkLines || !state.networkLines.length) {
    if (state.networkMask) {
      // Mask exists but geometry wasn't kept (over the vertex cap).
      status.textContent = t("status.net_too_large");
    }
    return;
  }
  // One shared canvas renderer — thousands of SVG paths would crawl.
  const renderer = L.canvas({ padding: 0.3, pane: "networkPane" });
  const weight = networkLineWeightPx();
  const opacity = networkLineOpacity();
  // A SINGLE Leaflet MultiPolyline (nested latlngs, one per line) instead of
  // one L.Polyline PER line — a city-scale network is 50k-200k lines, and one
  // layer object per line means seconds of main-thread build time plus
  // Leaflet re-iterating every one of them on every pan/zoom redraw. All
  // lines share the same style, so a single layer renders the identical
  // image.
  state.networkLinesLayer = L.polyline(state.networkLines, {
    color: "#000",
    weight,
    opacity,
    interactive: false,
    renderer,
    pane: "networkPane",
  }).addTo(map);
}

function updateNetworkLineStyle() {
  if (!state.networkLinesLayer) return;
  const weight = networkLineWeightPx();
  const opacity = networkLineOpacity();
  // state.networkLinesLayer is a single L.Polyline since applyNetworkLinesOverlay
  // was switched to the MultiPolyline form; the eachLayer branch is kept only
  // in case a layerGroup ever occurs again here.
  if (typeof state.networkLinesLayer.setStyle === "function") state.networkLinesLayer.setStyle({ weight, opacity });
  else state.networkLinesLayer.eachLayer((l) => l.setStyle({ weight, opacity }));
}

map.on("zoomend", updateNetworkLineStyle);

// Whether the loaded network actually constrains the NEXT compute. The
// "Constrain compute to network" checkbox lets a network stay loaded —
// e.g. for the vector line rendering — without restricting the search
// graph (or snapping clicks, or gating src/dst).
function networkConstraintActive() {
  return !!state.networkMask && (document.getElementById("vec-constrain")?.checked ?? true);
}

// Place the PRIMARY density tweaks (#passes-primary) under the sub-group that
// matches the DISPLAYED passes channel, and show/hide 3C.a / 3C.b accordingly:
//   - terrain (unconstrained selection, OR a compute with no network) → 3C.b
//   - network (constrained / difference A-channel)                    → 3C.a
//   - difference with both passes channels (dualPasses) → 3C.b also shows the
//     terrain B-channel overrides (#passes-dual-row).
// `networkUsed` must reflect whether THIS result is network-constrained (NOT just
// the energy-source value, which is "constrained" by default even for a plain
// terrain compute — that was the bug).
function applyDensityChannelGroups(energySel, networkUsed, dualPasses) {
  const primaryIsTerrain = energySel === "unconstrained" || (energySel !== "difference" && !networkUsed);
  const primaryCtl = document.getElementById("passes-primary");
  const netGroup = document.getElementById("result-density-net-group");
  const netBody  = document.getElementById("density-net-body");
  const terrGroup = document.getElementById("result-density-terrain-group");
  const terrBody  = document.getElementById("density-terrain-body");
  const dualRow   = document.getElementById("passes-dual-row");
  if (primaryCtl) {
    const host = primaryIsTerrain ? terrBody : netBody;
    if (host && primaryCtl.parentElement !== host) host.insertBefore(primaryCtl, host.firstChild);
  }
  if (netGroup)  netGroup.style.display  = primaryIsTerrain ? "none" : "";
  if (terrGroup) terrGroup.style.display = (primaryIsTerrain || dualPasses) ? "" : "none";
  if (dualRow)   dualRow.style.display   = dualPasses ? "" : "none";
}

// Snap a (row, col) pixel to the nearest network cell. Expanding-ring
// search with NO hard cutoff (capped only by the grid): the old version
// gave up at the snap-radius input, which on sparse networks turned every
// map click into a rejection — src never set, Compute permanently
// disabled. The radius input is now the "silent zone": snaps within it
// are quiet, snaps beyond it work too but the caller can tell the user
// how far the point moved (see snapToNetwork.lastDistance).
// Returns the original RC when the network is off / not constraining /
// genuinely empty.
function snapToNetwork(rc) {
  snapToNetwork.lastDistance = 0;
  if (!networkConstraintActive() || !state.dem) return rc;
  const [r, c] = rc;
  const { W, H, mask } = state.dem;
  if (r < 0 || r >= H || c < 0 || c >= W) return rc;
  if (state.networkMask[r * W + c]) return rc;
  const net = state.networkMask;
  const maxRing = Math.max(H, W);
  for (let ring = 1; ring <= maxRing; ring++) {
    let bestD2 = Infinity, bestRC = null;
    // Walk the square ring at Chebyshev distance `ring`. The first ring
    // containing network cells holds the Euclidean nearest among rings
    // ≤ ring+1; checking one extra ring after a hit keeps it exact enough
    // for snapping purposes (cells, not metres).
    const scanRing = (rg) => {
      for (let dc = -rg; dc <= rg; dc++) {
        for (const dr of (Math.abs(dc) === rg
          ? Array.from({ length: 2 * rg + 1 }, (_, k) => k - rg)
          : [-rg, rg])) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= H || cc < 0 || cc >= W) continue;
          const i = rr * W + cc;
          if (net[i] && mask[i]) {
            const d2 = dr * dr + dc * dc;
            if (d2 < bestD2) { bestD2 = d2; bestRC = [rr, cc]; }
          }
        }
      }
    };
    scanRing(ring);
    if (bestRC) {
      scanRing(Math.min(maxRing, ring + 1));
      snapToNetwork.lastDistance = Math.sqrt(bestD2);
      return bestRC;
    }
  }
  return rc; // empty network — caller handles the message
}

// ------- Map clicks: set points -------
// Convert lat/lon to DEM pixel coords. For a UTM DEM this needs proj4; for
// the prototype we accept WGS84 DEMs OR provide a small UTM helper.
// The cleanest demo path is to show the DEM extent on the map in its native
// units. To keep dependencies minimal, the prototype assumes DEMs in EPSG:4326.
// Production: pull in proj4 and parse the GeoKeys to get the source CRS.

function latLngToPixel(latlng) {
  if (!state.dem) return null;
  const { originX, originY, dx, dy, W, H, isGeographic } = state.dem;
  // For a geographic DEM (lon = x, lat = y):
  if (isGeographic) {
    const col = Math.floor((latlng.lng - originX) / dx);
    const row = Math.floor((originY - latlng.lat) / dy);
    if (row < 0 || row >= H || col < 0 || col >= W) return null;
    return [row, col];
  }
  // For UTM DEMs we'd need proj4 here. As a fallback, treat the click
  // as if it were in the DEM's native units (only useful for testing
  // against a small DEM you've manually situated).
  return null;
}

function pixelToLatLng(r, c) {
  if (!state.dem) return null;
  const { originX, originY, dx, dy, isGeographic } = state.dem;
  if (isGeographic) {
    return L.latLng(originY - (r + 0.5) * dy, originX + (c + 0.5) * dx);
  }
  return null;
}

// ------- "Follow the vectors" graph mode -------
// Routing on the real polyline graph (graph-engine.js) instead of the raster
// mask, so passes trace the vectors with no staircase. Geometry round-trips
// through FRACTIONAL cell space: lat/lng → (r,c) for the engine, (r,c) → lat/lng
// for rendering. Gated to geographic DEMs (the same constraint as map clicks).
function latLngToCellFrac(lat, lng) {
  const { originX, originY, dx, dy } = state.dem;
  return [(originY - lat) / dy, (lng - originX) / dx];
}
function cellFracToLatLng(r, c) {
  const { originX, originY, dx, dy } = state.dem;
  return L.latLng(originY - r * dy, originX + c * dx);
}
function networkLinesToCellLines() {
  // state.networkLines = [[ [lat,lng], … ], … ] → fractional [r,c] polylines.
  return state.networkLines.map((ln) => ln.map(([lat, lng]) => latLngToCellFrac(lat, lng)));
}
function graphJunctionMode() {
  return document.getElementById("vec-junction-mode")?.value === "shared" ? "shared" : "crossings";
}
// Graph mode is usable only with a vector network whose geometry was kept and a
// geographic DEM. The toggle lives in the network panel.
function graphModeActive() {
  return !!document.getElementById("vec-graph-mode")?.checked
    && !!state.networkLines && state.networkLines.length > 0
    && !!state.dem && state.dem.isGeographic;
}
// Graph mode ("follow the vectors") is a SEPARATE engine that computes on the
// network graph. The compute is INHERENTLY constrained to the network, so the
// raster "Constrain compute to network" toggle is forced ON and locked while
// graph mode is checked (its precedence is visible, not silently ignored).
// "Compare with unconstrained" STAYS togglable: graph mode now honours it,
// running a full-DEM unconstrained raster scenario alongside the graph compute
// and exposing the difference through the displayed-scenario picker (see
// startGraphCompute). The checkbox is persisted, so it can be on from a prior
// session; a synthetic change after restore re-runs this.
function syncGraphModeUI() {
  const graph = !!document.getElementById("vec-graph-mode")?.checked;
  // Constrain: forced ON + locked in graph mode (compute is always on the net).
  // Remember the user's prior choice in a data attribute and RESTORE it when they
  // leave graph mode — entering graph mode shouldn't silently flip "constrain" on
  // for good. Only snapshot on the first entry (repeated calls while graph is on
  // must not overwrite the snapshot with the now-forced value).
  const con = document.getElementById("vec-constrain");
  if (con) {
    if (graph) {
      if (con.dataset.preGraph === undefined) con.dataset.preGraph = con.checked ? "1" : "0";
      con.checked = true;
    } else if (con.dataset.preGraph !== undefined) {
      con.checked = con.dataset.preGraph === "1";
      delete con.dataset.preGraph;
    }
    con.disabled = graph;
    const row = con.closest("label");
    if (row) {
      row.style.opacity = graph ? "0.6" : "";
      // dataset.i18nTitle (same convention as #e-max, app.js ~1241) so
      // applyTranslations() keeps this tooltip current on a language
      // toggle instead of it going stale until graph mode is retoggled.
      if (graph) { row.dataset.i18nTitle = "net.graph_constrain_locked"; row.title = t("net.graph_constrain_locked"); }
      else { delete row.dataset.i18nTitle; row.title = ""; }
    }
  }
  // Compare: stays available — graph mode does run the comparison now.
  const cmp = document.getElementById("vec-compare");
  if (cmp) {
    cmp.disabled = false;
    const row = cmp.closest("label");
    if (row) { row.style.opacity = ""; row.title = ""; }
  }
}
// Identity of everything the cached graph depends on — a change rebuilds it.
function computeNetworkGraphToken() {
  return `${state.networkFeatureCount}|${graphJunctionMode()}|${state.dem ? state.dem.W + "x" + state.dem.H : "0"}|imp${state.impassableToken}`;
}

// Difference-view scenario colours, the single source of truth shared by the
// density passes overlay AND the source→destination route polylines: network /
// constrained = warm orange, terrain / unconstrained = azure blue. They are
// additive complements (sum to white where both routes coincide) and stay
// discriminable under red–green colour-blindness. Keeping the route lines on the
// same constants means they never drift from the field tints.
const NET_ORANGE = [255, 165, 60];
const TERR_BLUE  = [0, 90, 195];
const NET_ORANGE_CSS = `rgb(${NET_ORANGE[0]}, ${NET_ORANGE[1]}, ${NET_ORANGE[2]})`;
const TERR_BLUE_CSS  = `rgb(${TERR_BLUE[0]}, ${TERR_BLUE[1]}, ${TERR_BLUE[2]})`;

// Flat raster-index path → Leaflet [lat,lng] cell-centre polyline.
function rasterPathToLatLngs(p) {
  const { W, originX, originY, dx, dy } = state.dem;
  return p.map((idx) => {
    const rr = (idx / W) | 0;
    const cc = idx - rr * W;
    return [originY - (rr + 0.5) * dy, originX + (cc + 0.5) * dx];
  });
}

// Comparison content for a compare route line: shows BOTH the network and the
// terrain route's energy + length (and the Δ), so hovering / tapping EITHER line
// compares the two at once. `focus` ("network" | "terrain") bolds the line you
// are pointing at. Returns an HTML string (energies/lengths are numbers; the
// labels come from the trusted STRINGS table but are escaped defensively).
function compareRoutesContent(netE, netL, terrE, terrL, focus) {
  const fmtE = (e) => Number.isFinite(e) ? e.toExponential(2) : "—";
  const fmtL = (l) => Number.isFinite(l) ? (l / 1000).toFixed(2) + " km" : "—";
  const row = (swatch, label, e, l, on) => {
    const dot = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;` +
      `background:${swatch};margin-right:5px;vertical-align:middle"></span>`;
    const body = `${dot}${escapeHtml(label)}: E <span class="v">${fmtE(e)}</span> · ${fmtL(l)}`;
    return on ? `<strong>${body}</strong>` : body;
  };
  let html =
    row(NET_ORANGE_CSS, t("route.network"), netE, netL, focus === "network") + "<br/>" +
    row(TERR_BLUE_CSS,  t("route.terrain"), terrE, terrL, focus === "terrain");
  // Δ = network − terrain ≥ 0: the energy cost of staying on the network.
  if (Number.isFinite(netE) && Number.isFinite(terrE)) {
    const d = netE - terrE;
    const pct = terrE > 0 ? (d / terrE) * 100 : null;
    html += `<br/>${escapeHtml(t("route.delta"))}: <span class="v">${d >= 0 ? "+" : ""}${d.toExponential(2)}</span>` +
      (pct != null ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%)` : "");
  }
  // Disclosure, not recomputation: the two routes are cross-metric (8-connected
  // grid vs true polylines) — see the finding this note documents.
  html += `<br/><span style="opacity:.65;font-size:10px">${escapeHtml(t("route.compare_metric_note"))}</span>`;
  return html;
}

// Attach the compare content to a route line as BOTH a hover tooltip (desktop)
// and a click/tap popup (touch), so the energy comparison is reachable however
// the user points at it. `focus` flags which line this is.
function bindRouteCompare(layer, focus, netE, netL, terrE, terrL) {
  const html = compareRoutesContent(netE, netL, terrE, terrL, focus);
  layer.bindTooltip(html, { sticky: true });
  layer.bindPopup(html);
}

// Draw a path/route (sequence of node ids) as a polyline over the edges.
function drawGraphPath(graph, p, colour, group) {
  if (!p || !p.nodes || !p.nodes.length) return;
  const pts = p.nodes.map((n) => cellFracToLatLng(graph.nodeR[n], graph.nodeC[n]));
  group.addLayer(L.polyline(pts, { color: colour, weight: 4, opacity: 0.95, pane: "routesPane", interactive: false }));
}

// Render the cached graph result as a colored-vector overlay. Reads the style
// knobs LIVE so colormap/range/gamma changes recolor without recomputing.
// Rasterise the graph's per-node energy onto the DEM grid (network cells only),
// stamping each edge's lerped endpoint energy along its cells with the network
// line width. Returns a Float32Array (Infinity off-network) to feed the IDW
// interp, or null if there's no energy. Invalid (off-extent) edges are skipped.
function rasterizeGraphEnergy(graph, result) {
  if (!state.dem || !result.nodeEnergy) return null;
  const { H, W, mask } = state.dem;
  const lineWidth = Math.max(1, parseInt(document.getElementById("vec-width")?.value, 10) || 1);
  const halfWidth = (lineWidth - 1) >> 1;
  const eGrid = new Float32Array(H * W).fill(Infinity);
  let any = false;
  for (let e = 0; e < graph.nEdges; e++) {
    const a = graph.edgeA[e], b = graph.edgeB[e];
    if (graph.nodeValid && (!graph.nodeValid[a] || !graph.nodeValid[b])) continue;
    const eA = result.nodeEnergy[a], eB = result.nodeEnergy[b];
    const fA = Number.isFinite(eA), fB = Number.isFinite(eB);
    if (!fA && !fB) continue;
    const r0 = graph.nodeR[a], c0 = graph.nodeC[a], r1 = graph.nodeR[b], c1 = graph.nodeC[b];
    const steps = Math.max(1, Math.ceil(Math.hypot(r1 - r0, c1 - c0)));
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      // Fractional coords: integer values are cell CORNERS, so point r lives
      // in cell floor(r) — round() would shift the stamp half a cell. Clamp
      // so a point exactly on the far boundary lands in the edge cell.
      const rr = Math.min(H - 1, Math.max(0, Math.floor(r0 + (r1 - r0) * f)));
      const cc = Math.min(W - 1, Math.max(0, Math.floor(c0 + (c1 - c0) * f)));
      const ev = (fA ? eA : eB) * (1 - f) + (fB ? eB : eA) * f;
      for (let pdr = -halfWidth; pdr <= halfWidth; pdr++) {
        const rrr = rr + pdr; if (rrr < 0 || rrr >= H) continue;
        for (let pdc = -halfWidth; pdc <= halfWidth; pdc++) {
          const ccc = cc + pdc; if (ccc < 0 || ccc >= W) continue;
          const idx = rrr * W + ccc;
          if (!mask[idx]) continue;
          if (ev < eGrid[idx]) eGrid[idx] = ev;
          any = true;
        }
      }
    }
  }
  return any ? eGrid : null;
}

// Splat per-edge PASSES (3C.a network channel) onto the DEM grid — the raster
// twin of buildGraphFieldLayer's vectors, so the "filtro média N" mean filter
// can smooth them exactly like the terrain passes raster. Each cell takes the
// MAX passes of any edge crossing it (a junction shouldn't sum-inflate). Mirrors
// rasterizeGraphEnergy's walk; 0 = untouched (transparent).
function rasterizeGraphPasses(graph, edgePasses) {
  if (!state.dem || !edgePasses) return null;
  const { H, W, mask } = state.dem;
  const lineWidth = Math.max(1, parseInt(document.getElementById("vec-width")?.value, 10) || 1);
  const halfWidth = (lineWidth - 1) >> 1;
  const grid = new Float32Array(H * W); // 0-filled
  let any = false;
  for (let e = 0; e < graph.nEdges; e++) {
    const v = edgePasses[e];
    if (!Number.isFinite(v) || v <= 0) continue;
    const a = graph.edgeA[e], b = graph.edgeB[e];
    if (graph.nodeValid && (!graph.nodeValid[a] || !graph.nodeValid[b])) continue;
    const r0 = graph.nodeR[a], c0 = graph.nodeC[a], r1 = graph.nodeR[b], c1 = graph.nodeC[b];
    const steps = Math.max(1, Math.ceil(Math.hypot(r1 - r0, c1 - c0)));
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      // Same corner-based convention as rasterizeGraphEnergy: floor + clamp.
      const rr = Math.min(H - 1, Math.max(0, Math.floor(r0 + (r1 - r0) * f)));
      const cc = Math.min(W - 1, Math.max(0, Math.floor(c0 + (c1 - c0) * f)));
      for (let pdr = -halfWidth; pdr <= halfWidth; pdr++) {
        const rrr = rr + pdr; if (rrr < 0 || rrr >= H) continue;
        for (let pdc = -halfWidth; pdc <= halfWidth; pdc++) {
          const ccc = cc + pdc; if (ccc < 0 || ccc >= W) continue;
          const idx = rrr * W + ccc;
          if (!mask[idx]) continue;
          if (v > grid[idx]) grid[idx] = v;
          any = true;
        }
      }
    }
  }
  return any ? grid : null;
}

// Remove all graph-mode layers and reset the pane opacities (the raster
// overlays assume the panes sit at opacity 1 and set their own element opacity).
function removeGraphLayers() {
  for (const k of ["graphEnergyLayer", "graphPassesLayer", "graphRoutesLayer"]) {
    if (state[k]) { state[k].remove(); state[k] = null; }
  }
  const ep = map.getPane("energyPane"), pp = map.getPane("passesPane");
  if (ep) ep.style.opacity = "";
  if (pp) { pp.style.opacity = ""; pp.style.mixBlendMode = ""; }
}

// Build one colored-polyline-per-edge vector layer for a per-edge field.
// greyscale matches the raster passes layer; colormap matches the energy layer.
// Returns a layerGroup with `_range = [lo, hi]` for the legend.
function buildGraphFieldLayer(graph, field, { pane, greyscale, tint, minId, maxId, percentiles, skipZero }) {
  if (state.dem) field = passesAsDensity(field, state.dem.W, state.dem.H); // counts → density units
  // Collect drawable values. skipZero mirrors the raster's treatZeroAsTransparent:
  // zero / unreached edges DON'T draw, so the result reads as corridors instead
  // of a full-network outline. Percentile bounds tame the long passes tail.
  const vals = [];
  for (let e = 0; e < graph.nEdges; e++) {
    const v = field[e];
    if (!Number.isFinite(v)) continue;
    if (skipZero && v <= 0) continue;
    vals.push(v);
  }
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  const pAt = (p) => vals[Math.min(vals.length - 1, Math.max(0, Math.floor((p / 100) * (vals.length - 1))))];
  let lo = pAt(percentiles[0]), hi = pAt(percentiles[1]);
  const uMin = readRangeInput(minId, null), uMax = readRangeInput(maxId, null);
  if (uMin != null) lo = uMin;
  if (uMax != null) hi = uMax;
  const span = hi > lo ? hi - lo : 1;
  const gamma = Math.max(0.05, parseFloat(document.getElementById("passes-gamma")?.value) || 1);
  const weight = Math.max(1.5, networkLineWeightPx());
  const renderer = L.canvas({ padding: 0.3, pane });
  // Quantise per-edge intensity into a fixed number of colour/opacity BINS and
  // emit one MultiPolyline (nested latlngs) PER NON-EMPTY BIN, instead of one
  // L.Polyline per edge — a city-scale network is 10^5-10^6 drawable edges
  // after junction splitting, and that many individual layer objects freezes
  // the main thread on build and makes Leaflet's canvas renderer re-iterate
  // all of them on every pan/zoom. Colour/opacity is evaluated at the BIN
  // CENTRE, so quantisation error is at most ±1/(2·GRAPH_FIELD_BINS) of the
  // intensity range — imperceptible.
  const GRAPH_FIELD_BINS = 32;
  const binLatLngs = new Array(GRAPH_FIELD_BINS);
  for (let e = 0; e < graph.nEdges; e++) {
    const v = field[e];
    if (!Number.isFinite(v)) continue;
    if (skipZero && v <= 0) continue;
    let t = (v - lo) / span; t = t < 0 ? 0 : (t > 1 ? 1 : t);
    t = Math.pow(t, gamma);
    const bin = Math.min(GRAPH_FIELD_BINS - 1, Math.floor(t * GRAPH_FIELD_BINS));
    const a = graph.edgeA[e], b = graph.edgeB[e];
    const pair = [cellFracToLatLng(graph.nodeR[a], graph.nodeC[a]), cellFracToLatLng(graph.nodeR[b], graph.nodeC[b])];
    (binLatLngs[bin] || (binLatLngs[bin] = [])).push(pair);
  }
  const group = L.layerGroup();
  for (let bin = 0; bin < GRAPH_FIELD_BINS; bin++) {
    const pairs = binLatLngs[bin];
    if (!pairs || !pairs.length) continue;
    const tc = (bin + 0.5) / GRAPH_FIELD_BINS; // bin-centre, already gamma-mapped
    let col, op = 1;
    // Tint (difference view): keep the HUE constant (a true orange / azure) and
    // encode intensity as OPACITY. Multiplying the tint RGB by t (the old way)
    // darkened mid-values into a muddy yellow-brown that didn't read as the
    // channel colour, and made min/max edits look unresponsive (dark→dark).
    if (tint) { const [tr, tg, tb] = tint; col = `rgb(${tr},${tg},${tb})`; op = 0.3 + 0.7 * tc; }
    else if (greyscale) { const g = Math.round(tc * 255); col = `rgb(${g},${g},${g})`; }
    else { const [cr, cg, cb] = colormap(tc); col = `rgb(${cr},${cg},${cb})`; }
    group.addLayer(L.polyline(pairs, { color: col, weight, opacity: op, interactive: false, renderer }));
  }
  group._range = [lo, hi];
  return group;
}

// Render the cached graph result as a pane-integrated vector layer driven by the
// existing visibility/opacity controls, plus a routes/path layer. Passes (the
// "follow the vectors" corridors) is the primary result; energy is shown ONLY
// when there are no passes (an energy-only from/to) — otherwise colouring every
// reached edge just restates the network, which the user already toggles via
// "Draw network". Reads style knobs live → recolours on restyle, no recompute.
function renderGraphOverlay() {
  if (!state.lastGraphResult || !state.dem) return;
  const { graph, result, energyAlt, passesAlt, pathAlt, pathAltEnergy, pathAltLengthM } = state.lastGraphResult;
  const { W, H } = state.dem;
  if (state.passesOverlay) { state.passesOverlay.remove(); state.passesOverlay = null; }
  removeGraphLayers();

  // The displayed-scenario picker only makes sense after a graph-mode COMPARE run.
  const srcRow = document.getElementById("energy-source-row");
  if (srcRow) srcRow.style.display = energyAlt ? "" : "none";
  const energySel = energyAlt
    ? (document.getElementById("energy-source")?.value || "constrained")
    : "constrained";

  // Energy: interpolated RASTER (built in finishGraph), shown through the same
  // energy imageOverlay grid mode uses → the Energy visibility/opacity/colormap
  // controls drive it, and it reads as a smooth field, not a network outline.
  // In a compare run the picker swaps the raster: the graph (constrained) field,
  // the full-DEM unconstrained field, or their difference.
  if (state.energyOverlay) { state.energyOverlay.remove(); state.energyOverlay = null; }
  const energyField = (energyAlt && energySel === "unconstrained" && energyAlt.unconstrained)
    ? energyAlt.unconstrained
    : (energyAlt && energySel === "difference" && energyAlt.difference)
      ? energyAlt.difference
      : state.graphEnergyRaster;
  if (energyField) {
    const out = renderFieldToDataURL(energyField, W, H, {
      usePercentileBounds: true, percentiles: [1, 80],
      userMin: readRangeInput("vmin", null), userMax: readRangeInput("vmax", null),
      useGreyscale: false, treatZeroAsTransparent: false,
    });
    state.energyDataUrl = out.url;
    state.lastAutoMin = out.lo; state.lastAutoMax = out.hi;
    applyEnergyOverlay();
  } else {
    state.energyDataUrl = null;
  }

  // Passes. Network = the graph "follow-the-vectors" corridors (3C.a). When a
  // compare produced terrain (free-movement) passes, the difference / unconstrained
  // views ALSO show them as a RASTER overlay (3C.b) — the terrain is NOT graphed.
  const hasPasses = !!(result.edgePasses && result.edgePasses.some((v) => v > 0));
  const terrainPasses = passesAlt && passesAlt.unconstrained;
  const showNet = hasPasses && energySel !== "unconstrained";              // graph vector passes
  const showTerr = !!terrainPasses && (energySel === "unconstrained" || energySel === "difference");
  // In the difference view, colour the two channels like the raster difference:
  // network = warm orange, terrain = azure blue (additive complements → white on
  // overlap, discriminable under red–green colour-blindness). Single-scenario
  // views stay greyscale, matching raster mode.
  const diffView = energySel === "difference";
  const numOr = (id, fb) => { const v = parseFloat(document.getElementById(id)?.value); return Number.isFinite(v) ? v : fb; };
  const intOr = (id, fb) => { const v = parseInt(document.getElementById(id)?.value, 10); return Number.isFinite(v) ? v : fb; };
  const phB = (id, v) => { const el = document.getElementById(id); if (el) el.placeholder = v; };
  // 3C.a network channel: precise VECTORS when "filtro média N" is empty; a
  // rasterised + mean-smoothed grid when N is set (so it respects the mean filter
  // exactly like the terrain raster). A rasterised network can't share the single
  // passes overlay with the terrain raster, so in the difference view the two are
  // composited into one orange/azure image (renderDualPassesToDataURL — the same
  // path raster mode's difference uses, additive blend baked into the pixels).
  const netWin = parseInt(document.getElementById("passes-mean-window")?.value, 10);
  const netRasterize = showNet && Number.isFinite(netWin) && netWin > 1;

  if (showNet && !netRasterize) {
    state.graphPassesLayer = buildGraphFieldLayer(graph, result.edgePasses, {
      pane: "passesPane", greyscale: !diffView, tint: diffView ? NET_ORANGE : null,
      minId: "passes-vmin", maxId: "passes-vmax", percentiles: [10, 90], skipZero: true });
    if (state.graphPassesLayer) {
      state.graphPassesLayer.addTo(map);
      state.lastPassesAutoMin = state.graphPassesLayer._range[0];
      state.lastPassesAutoMax = state.graphPassesLayer._range[1];
    }
  }

  if (netRasterize && showTerr) {
    // Difference: rasterised network (orange, A) + terrain (azure, B) → one image.
    const netGrid = rasterizeGraphPasses(graph, result.edgePasses);
    if (netGrid) {
      const gammaB = numOr("passes-gamma-b", null), winB = intOr("passes-mean-window-b", null);
      const out = renderDualPassesToDataURL(netGrid, terrainPasses, W, H, {
        userMin: readRangeInput("passes-vmin", null), userMax: readRangeInput("passes-vmax", null),
        gamma: numOr("passes-gamma", 1), meanWindow: netWin,
        userMinB: readRangeInput("passes-vmin-b", null), userMaxB: readRangeInput("passes-vmax-b", null),
        gammaB, meanWindowB: winB,
      });
      state.passesDataUrl = out.url;
      state.lastPassesAutoMin = out.lo; state.lastPassesAutoMax = out.hi;
      // 3C.b placeholders = the RESOLVED B (terrain) values; inputs stay empty.
      phB("passes-vmin-b", out.loB != null ? formatSci(out.loB) : "=");
      phB("passes-vmax-b", out.hiB != null ? formatSci(out.hiB) : "=");
      phB("passes-gamma-b", String(gammaB != null ? gammaB : numOr("passes-gamma", 1)));
      phB("passes-mean-window-b", String(winB != null && winB > 1 ? winB : netWin));
    } else state.passesDataUrl = null;
  } else if (netRasterize) {
    // Constrained: rasterised network only → single greyscale raster.
    const netGrid = rasterizeGraphPasses(graph, result.edgePasses);
    if (netGrid) {
      const out = renderFieldToDataURL(netGrid, W, H, {
        usePercentileBounds: true, percentiles: [10, 90], maxAboveMin: true,
        userMin: readRangeInput("passes-vmin", null), userMax: readRangeInput("passes-vmax", null),
        gamma: numOr("passes-gamma", 1), meanWindow: netWin,
        useGreyscale: true, treatZeroAsTransparent: true, densityNormalize: true,
      });
      state.passesDataUrl = out.url;
      state.lastPassesAutoMin = out.lo; state.lastPassesAutoMax = out.hi;
    } else state.passesDataUrl = null;
  } else if (showTerr) {
    // Terrain passes raster (network is vectors or absent). When terrain is the
    // displayed PRIMARY channel (unconstrained) it uses the PRIMARY controls —
    // exactly like raster mode, so the mean filter (default 5) applies and it
    // isn't thin. In the difference view it's the B-channel override, inheriting
    // the A value where empty.
    const terrPrimary = !showNet;
    const aGamma = numOr("passes-gamma", 1), aWin = intOr("passes-mean-window", 1);
    const gamma = terrPrimary ? aGamma : numOr("passes-gamma-b", aGamma);
    const win   = terrPrimary ? aWin   : intOr("passes-mean-window-b", aWin);
    const uMin = terrPrimary ? readRangeInput("passes-vmin", null)
      : (readRangeInput("passes-vmin-b", null) ?? readRangeInput("passes-vmin", null));
    const uMax = terrPrimary ? readRangeInput("passes-vmax", null)
      : (readRangeInput("passes-vmax-b", null) ?? readRangeInput("passes-vmax", null));
    const out = renderFieldToDataURL(terrainPasses, W, H, {
      usePercentileBounds: true, percentiles: [10, 90], maxAboveMin: true,
      userMin: uMin, userMax: uMax,
      gamma, meanWindow: win > 1 ? win : 1,
      useGreyscale: !diffView, tint: diffView ? TERR_BLUE : null, tintOpacityRamp: diffView,
      treatZeroAsTransparent: true, densityNormalize: true,
    });
    state.passesDataUrl = out.url;
    if (!showNet) { state.lastPassesAutoMin = out.lo; state.lastPassesAutoMax = out.hi; }
    // Difference view: surface the RESOLVED terrain values as the 3C.b placeholders
    // — the inputs stay empty (= inheriting) but show the inferred number, not "=".
    if (showNet) {
      phB("passes-vmin-b", out.lo != null ? formatSci(out.lo) : "=");
      phB("passes-vmax-b", out.hi != null ? formatSci(out.hi) : "=");
      phB("passes-gamma-b", String(gamma));
      phB("passes-mean-window-b", String(win > 1 ? win : 1));
    }
  } else {
    state.passesDataUrl = null;
  }
  applyPassesOverlay();
  const routesGroup = L.layerGroup();
  if (energyAlt && pathAlt && pathAlt.length) {
    // Compare run: the scenario picker switches the BEST ROUTE the same way it
    // switches the field — the network (graph) route in orange, the unconstrained
    // terrain (raster) route in blue, both together in the difference view. Single
    // best per scenario (top-N collapses to the optimum here).
    const showNetRoute  = energySel === "constrained" || energySel === "difference";
    const showTerrRoute = energySel === "unconstrained" || energySel === "difference";
    const netGraphPath = result.path || (result.routes && result.routes.length ? result.routes[0] : null);
    const netE = netGraphPath ? netGraphPath.energy : null;
    const netL = netGraphPath ? netGraphPath.lengthM : null;
    if (showTerrRoute) {
      const ln = L.polyline(rasterPathToLatLngs(pathAlt), {
        color: TERR_BLUE_CSS, weight: 4, opacity: 0.95, pane: "routesPane",
      });
      bindRouteCompare(ln, "terrain", netE, netL, pathAltEnergy, pathAltLengthM);
      routesGroup.addLayer(ln);
    }
    if (showNetRoute && netGraphPath) {
      // Draw the graph route directly (interactive) rather than via drawGraphPath
      // (which is interactive:false) so it carries the compare tooltip/popup too.
      const pts = netGraphPath.nodes.map((n) => cellFracToLatLng(graph.nodeR[n], graph.nodeC[n]));
      const ln = L.polyline(pts, {
        color: NET_ORANGE_CSS, weight: 4, opacity: 0.95, pane: "routesPane",
      });
      bindRouteCompare(ln, "network", netE, netL, pathAltEnergy, pathAltLengthM);
      routesGroup.addLayer(ln);
    }
  } else if (result.routes && result.routes.length) {
    for (let i = 0; i < result.routes.length; i++) drawGraphPath(graph, result.routes[i], routeColour(i, result.routes.length), routesGroup);
  } else if (result.path) {
    drawGraphPath(graph, result.path, "#4cc9f0", routesGroup);
  }
  routesGroup.addTo(map);
  state.graphRoutesLayer = routesGroup;

  const passesRow = document.getElementById("passes-row");
  if (passesRow) passesRow.style.display = (showNet || showTerr) ? "" : "none";
  // Channel mapping mirrors the raster path: the PRIMARY controls live with the
  // displayed primary channel — network (3C.a) unless terrain is the ONLY channel
  // (unconstrained), where they move to 3C.b so you edit real values there. The
  // B-channel dual-row shows only in the difference view (both channels visible).
  const primaryCtl = document.getElementById("passes-primary");
  const netBody = document.getElementById("density-net-body");
  const terrBody = document.getElementById("density-terrain-body");
  const dualRow = document.getElementById("passes-dual-row");
  const terrPrimary = showTerr && !showNet;
  const primaryHost = terrPrimary ? terrBody : netBody;
  if (primaryCtl && primaryHost && primaryCtl.parentElement !== primaryHost) primaryHost.insertBefore(primaryCtl, primaryHost.firstChild);
  if (dualRow && terrBody && dualRow.parentElement !== terrBody) terrBody.appendChild(dualRow);
  const netGroup = document.getElementById("result-density-net-group");
  const terrGroup = document.getElementById("result-density-terrain-group");
  if (netGroup) netGroup.style.display = showNet ? "" : "none";
  if (terrGroup) terrGroup.style.display = showTerr ? "" : "none";
  if (dualRow) dualRow.style.display = (showNet && showTerr) ? "" : "none";

  applyLayerControls();   // drive visibility + opacity from the Energy/Passes controls
  // Difference view: additively blend the azure terrain raster over the orange
  // network vectors so overlap sums to white (matches the raster difference).
  // After applyLayerControls, which would otherwise reset blend to passes-blend.
  if (diffView && showTerr && state.passesOverlay) {
    const el = state.passesOverlay.getElement();
    // The combined network+terrain raster (netRasterize) already bakes the
    // additive blend into its pixels, so it draws NORMAL; the vector-network
    // difference still needs plus-lighter to add the azure terrain raster over
    // the orange network vectors.
    if (el) el.style.mixBlendMode = netRasterize ? "normal" : "plus-lighter";
  }
  updateLegendTicks();
  applyColormapToLegend();
  // Show the resolved auto bounds as the 3C.a passes + 3B energy input
  // placeholders — graph mode never called this, so they stayed at the static
  // "p10"/"p90"/"auto" defaults instead of the real numbers.
  syncRangePlaceholders();
}

map.on("click", (e) => {
  // While a Geoman draw is armed, map clicks are placing polygon/line vertices —
  // don't ALSO drop a source/reference point (the two were confounding).
  if (drawMode || (map.pm && map.pm.globalDrawModeEnabled && map.pm.globalDrawModeEnabled())) return;
  if (!state.dem) {
    status.textContent = t("status.load_dem_first");
    return;
  }
  const rawPx = latLngToPixel(e.latlng);
  if (!rawPx) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.click_outside")}</span>`;
    return;
  }
  // When a vector network is loaded, click points are snapped to the
  // nearest passable network cell within the configured radius.
  const px = snapToNetwork(rawPx);
  const [r, c] = px;
  const clickIdx = r * state.dem.W + c;
  if (!state.dem.mask[clickIdx]) {
    status.textContent = t("status.click_nodata");
    return;
  }
  if (!effectivePassableAt(clickIdx)) {
    // Impassable (barrier mask) and not reopened as a bridge corridor — the
    // compute would silently never seed/settle here.
    status.textContent = t("imp.cell_blocked");
    return;
  }
  if (networkConstraintActive() && !state.networkMask[r * state.dem.W + c]) {
    // Snap searches the whole grid now, so this only fires when the network
    // rasterised to zero usable cells (CRS/geometry mismatch with the DEM).
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.net_no_snap_click")}</span>`;
    return;
  }
  // Density mode: clicks always add a reference point, regardless of the
  // #ref-sampling mode (random/sobol/halton/census) — that select only picks
  // how "Distribuir aleatórias" seeds points, not what a map click does. They
  // must never fall through to the src/dst branch below — density runs
  // ignore src/dst, so a silently-set source marker would contradict the
  // "— density —" displays and leak a stale seed into the compute message.
  const densityOn = !!document.getElementById("want-density")?.checked;
  if (densityOn) {
    addRefPoint([r, c]);
    return;
  }
  if (!state.src) {
    state.src = px;
    if (state.srcMarker) state.srcMarker.remove();
    state.srcMarker = L.marker(e.latlng, { icon: makeSrcDstIcon("src") })
      .addTo(map).bindTooltip(t("marker.src"));
    document.getElementById("src-display").textContent = `r=${r}, c=${c}`;
    document.getElementById("src-display").classList.add("set");
    status.textContent = t("status.src_set");
    updateRunButtonState();
  } else if (!state.dst) {
    state.dst = px;
    if (state.dstMarker) state.dstMarker.remove();
    state.dstMarker = L.marker(e.latlng, { icon: makeSrcDstIcon("dst") })
      .addTo(map).bindTooltip(t("marker.dst"));
    document.getElementById("dst-display").textContent = `r=${r}, c=${c}`;
    document.getElementById("dst-display").classList.add("set");
    status.textContent = t("status.both_set");
    updateRunButtonState(); // refresh 3B status (now src + dst → green)
  } else {
    // Reset and start over
    state.src = px;
    state.dst = null;
    if (state.srcMarker) state.srcMarker.remove();
    if (state.dstMarker) state.dstMarker.remove();
    state.srcMarker = L.marker(e.latlng, { icon: makeSrcDstIcon("src") })
      .addTo(map).bindTooltip(t("marker.src"));
    state.dstMarker = null;
    document.getElementById("src-display").textContent = `r=${r}, c=${c}`;
    document.getElementById("dst-display").textContent = t("pts.click_again");
    document.getElementById("dst-display").classList.remove("set");
    status.textContent = t("status.src_replaced");
    updateRunButtonState(); // refresh 3B status (src only → orange)
  }
});

document.getElementById("clear-points").addEventListener("click", () => {
  state.src = null;
  state.dst = null;
  if (state.srcMarker) { state.srcMarker.remove(); state.srcMarker = null; }
  if (state.dstMarker) { state.dstMarker.remove(); state.dstMarker = null; }
  if (state.pathLine) { state.pathLine.remove(); state.pathLine = null; }
  document.getElementById("src-display").textContent = t("pts.click_map");
  document.getElementById("dst-display").textContent = t("pts.optional");
  document.getElementById("src-display").classList.remove("set");
  document.getElementById("dst-display").classList.remove("set");
  updateRunButtonState();
});

// ------- Marker icons -------
// Source / destination / reference points all share a white-disc-with-
// black-border style. Tiny label text inside (`src` / `dst` / a 1-based
// order number for refs).
function makeLabelIcon(label, size, fontSize, bg = "#fff") {
  const html = `<div style="
    width:${size}px;height:${size}px;
    background:${bg};border:2px solid #000;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    font-family:ui-monospace,monospace;font-weight:700;color:#000;
    font-size:${fontSize}px;line-height:1;box-sizing:border-box;
    white-space:nowrap;
  ">${label}</div>`;
  return L.divIcon({
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    className: "",
  });
}
const ICON_SRCDST_SIZE = 28, ICON_SRCDST_FONT = 9;
const ICON_REF_SIZE    = 20, ICON_REF_FONT    = 10;
const makeSrcDstIcon = (label) => makeLabelIcon(label, ICON_SRCDST_SIZE, ICON_SRCDST_FONT);
const makeRefIcon    = (idx, bg) => makeLabelIcon(String(idx), ICON_REF_SIZE, ICON_REF_FONT, bg);

// ------- Multi-reference density helpers -------
// FIFO buffer: state.refPoints / state.refMarkers are kept in arrival order.
// Once the population exceeds the `N references` cap, the oldest entries are
// dropped from the front. Applies to single clicks AND to "Place random".
function addRefPoint(rc) {
  if (!state.dem) return;
  const [r, c] = rc;
  if (!effectivePassableAt(r * state.dem.W + c)) return; // nodata or blocked (barrier mask)
  // Any ref-set change voids the census population proxy and the cached
  // accessibility matrix (its rows are keyed to the refs it ran with).
  // placeCensusRefPoints re-assigns refPopM AFTER its addRefPoint loop.
  state.refPopM = null;
  kpiInvalidate();
  state.refPoints.push([r, c]);
  const { originX, originY, dx, dy } = state.dem;
  const latlng = L.latLng(originY - (r + 0.5) * dy, originX + (c + 0.5) * dx);
  const idx = state.refPoints.length;
  const m = L.marker(latlng, { icon: makeRefIcon(idx) })
    .bindTooltip(`ref ${idx} · r=${r}, c=${c}`);
  // Respect the visibility toggle: a marker added while refs are hidden stays
  // off the map until the toggle re-adds it (applyLayerControls).
  if (document.getElementById("refs-visible")?.checked ?? true) m.addTo(map);
  state.refMarkers.push(m);
  enforceRefCap();
  syncRefDisplay();
}

function enforceRefCap() {
  const cap = Math.max(1, parseInt(document.getElementById("n-refs")?.value, 10) || 10);
  if (state.refPoints.length > cap) {
    state.refPopM = null; // trimmed refs no longer match the census sample
    kpiInvalidate();
  }
  while (state.refPoints.length > cap) {
    state.refPoints.shift();
    const oldest = state.refMarkers.shift();
    if (oldest) oldest.remove();
  }
  // After a FIFO trim the surviving refs need their numbered icons
  // refreshed so what's drawn matches the (now reset) order.
  for (let i = 0; i < state.refMarkers.length; i++) {
    const marker = state.refMarkers[i];
    const [r, c] = state.refPoints[i];
    marker.setIcon(makeRefIcon(i + 1));
    marker.unbindTooltip().bindTooltip(`ref ${i + 1} · r=${r}, c=${c}`);
  }
}

function clearRefPoints() {
  for (const m of state.refMarkers) m.remove();
  state.refMarkers = [];
  state.refPoints = [];
  state.qmcIndex = 0;
  state.refPopM = null;
  kpiInvalidate();
  syncRefDisplay();
}

// Drop the cached accessibility matrix + KPI block and restore the default
// ref-marker icons/tooltips. Called on ANY change that would desynchronise
// the cache from what's on screen: ref add/clear/trim, DEM load (via
// clearRefPoints in resetForNewDem), network load/clear, or a new result
// without a matrix. Safe to call repeatedly / before the UI exists.
function kpiInvalidate() {
  if (!state.kpi) return;
  state.kpi = null;
  const group = document.getElementById("kpi-group");
  if (group) group.style.display = "none";
  // Undo the accessibility recoloring (markers may have been trimmed since).
  for (let i = 0; i < state.refMarkers.length; i++) {
    const marker = state.refMarkers[i];
    const rc = state.refPoints[i];
    if (!marker || !rc) continue;
    marker.setIcon(makeRefIcon(i + 1));
    marker.unbindTooltip().bindTooltip(`ref ${i + 1} · r=${rc[0]}, c=${rc[1]}`);
  }
}

// ---- Quasi-Monte-Carlo point sets for reference placement ----------------
// Low-discrepancy sequences cover the DEM evenly (no clumps/gaps), so the
// density field converges with fewer reference points than pseudo-random
// placement. Both generators are indexed (stateless given i), and the app
// keeps a persistent counter (state.qmcIndex) so successive "Place random"
// clicks CONTINUE the sequence — re-starting at i=0 every click would drop
// the same points on top of the previous batch.

// Bit-reversal of a u32 = van der Corput base-2 radical inverse, which is
// both the Halton base-2 axis and Sobol dimension 1.
function bitReverse32(x) {
  x = ((x & 0x55555555) << 1) | ((x >>> 1) & 0x55555555);
  x = ((x & 0x33333333) << 2) | ((x >>> 2) & 0x33333333);
  x = ((x & 0x0f0f0f0f) << 4) | ((x >>> 4) & 0x0f0f0f0f);
  x = ((x & 0x00ff00ff) << 8) | ((x >>> 8) & 0x00ff00ff);
  return ((x << 16) | (x >>> 16)) >>> 0;
}

// Sobol dimension-2 direction numbers (primitive polynomial x²+x+1; the
// recurrence reproduces the canonical m = 1, 3, 5, 15, 17, … table).
const SOBOL_DIM2_V = (() => {
  const v = new Uint32Array(32);
  v[0] = 0x80000000;
  for (let j = 1; j < 32; j++) v[j] = (v[j - 1] ^ (v[j - 1] >>> 1)) >>> 0;
  return v;
})();

// i-th 2-D Sobol point, i ≥ 1 (i = 0 is the degenerate (0,0) corner).
// First points: (.5,.5) (.25,.75) (.75,.25) (.125,.625) …
function sobolPoint2D(i) {
  const u = bitReverse32(i >>> 0) / 2 ** 32;
  let x = 0;
  for (let j = 0; j < 32; j++) {
    if ((i >>> j) & 1) x = (x ^ SOBOL_DIM2_V[j]) >>> 0;
  }
  return [u, x / 2 ** 32];
}

// i-th 2-D Halton point (bases 2 and 3), i ≥ 1.
function haltonPoint2D(i) {
  const u = bitReverse32(i >>> 0) / 2 ** 32;
  let v = 0, f = 1 / 3, k = i;
  while (k > 0) {
    v += (k % 3) * f;
    k = (k / 3) | 0;
    f /= 3;
  }
  return [u, v];
}

function placeRandomRefPoints(n) {
  if (!state.dem) return;
  const { mask, H, W } = state.dem;
  // Reservoir of valid cell indices is too big to enumerate for huge DEMs;
  // rejection sampling is fine for typical mask densities (~99% valid) and
  // preserves the QMC sequences' even coverage over the masked subset.
  const want = Math.max(1, Math.min(2000, n | 0));
  const sampling = document.getElementById("ref-sampling")?.value || "random";
  // "census" is population-weighted and runs an async cloud query (FlatGeobuf
  // over the DEM bbox); fork to it and leave the QMC/random paths synchronous.
  if (sampling === "census") { placeCensusRefPoints(want); return; }
  const nextUV =
    sampling === "sobol"  ? () => sobolPoint2D(++state.qmcIndex) :
    sampling === "halton" ? () => haltonPoint2D(++state.qmcIndex) :
    () => [Math.random(), Math.random()];
  let attempts = 0;
  const cap = want * 200;
  const placed = [];
  const seen = new Set();
  // With a constraining network, snap each sample to its nearest network
  // cell (grid-wide) — sampling the raw mask and rejecting would need
  // ~1/density attempts on sparse networks, and compute-time snapping
  // would silently move the points anyway. Snapped samples can collide,
  // hence the dedupe.
  const constrained = networkConstraintActive();
  while (placed.length < want && attempts++ < cap) {
    const [u, v] = nextUV();
    let r = (v * H) | 0;
    let c = (u * W) | 0;
    if (!mask[r * W + c]) continue;
    if (constrained) {
      [r, c] = snapToNetwork([r, c]);
      if (!state.networkMask[r * W + c]) continue; // empty network
    }
    const key = r * W + c;
    if (seen.has(key)) continue;
    seen.add(key);
    placed.push([r, c]);
  }
  for (const rc of placed) addRefPoint(rc);
}

// ---- Census (IBGE 2022) population-weighted reference sampling ------------
// A live, in-browser port of census/sample_census.py. Instead of spreading
// references uniformly, it samples them by where people actually live: fetch
// the census setores intersecting the DEM bbox from a cloud FlatGeobuf (HTTP
// Range queries — only the bbox slice transfers, not the ~450 MB national
// file), weight each setor by pop·(area clipped to the DEM / full area), pick
// setores by a 1-D Sobol inverse-CDF, and drop each point inside its setor
// with a 2-D Sobol rejection draw. Brazil-only; needs the network. Structural
// parity with the Python (NOT bit-parity — there's no harness pairing them).
const CENSUS_FGB_URL =
  "https://storage.googleapis.com/simujaules/census/setores_br_pop.fgb";
// Built + uploaded out-of-band by census/build_fgb.py — it lives in the cloud
// bucket, NOT in the deployed app bundle (deploy.sh never stages census/).
// Coarse Brazil bbox: skip the (multi-MB) index walk for DEMs that can't
// possibly intersect the national census coverage.
const BRAZIL_BBOX = { xmin: -74.5, ymin: -34.5, xmax: -28.5, ymax: 6.0 };

// 1-D Sobol / van der Corput scalar in [0,1) — the first axis of sobolPoint2D.
function sobolScalar1D(i) { return bitReverse32(i >>> 0) / 2 ** 32; }

// Ray-cast (even-odd) point-in-ring test; ring = [[lng,lat], …].
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
// A polygon is [outerRing, hole1, …]: inside the outer ring and outside holes.
function pointInPolygon(x, y, rings) {
  if (!rings.length || !pointInRing(x, y, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) if (pointInRing(x, y, rings[h])) return false;
  return true;
}

// Shoelace ring area (abs; works on open or closed rings). lon/lat units — we
// only ever use the clipped/full RATIO, which is valid in any consistent CRS.
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
}
function polyArea(rings) {        // outer − holes
  let a = rings.length ? ringArea(rings[0]) : 0;
  for (let h = 1; h < rings.length; h++) a -= ringArea(rings[h]);
  return Math.max(0, a);
}

// Sutherland–Hodgman clip of a ring against the axis-aligned DEM bbox; returns
// the clipped vertex list (possibly empty). Used only for the area ratio.
function clipRingToBbox(ring, bb) {
  let poly = ring;
  if (poly.length > 1) {         // drop the duplicate closing vertex if present
    const a = poly[0], b = poly[poly.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) poly = poly.slice(0, -1);
  }
  const ix = (p, q, x) => { const t = (x - p[0]) / (q[0] - p[0]); return [x, p[1] + t * (q[1] - p[1])]; };
  const iy = (p, q, y) => { const t = (y - p[1]) / (q[1] - p[1]); return [p[0] + t * (q[0] - p[0]), y]; };
  const clip = (pts, inside, cut) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i], prev = pts[(i + pts.length - 1) % pts.length];
      const ci = inside(cur), pi = inside(prev);
      if (ci) { if (!pi) out.push(cut(prev, cur)); out.push(cur); }
      else if (pi) out.push(cut(prev, cur));
    }
    return out;
  };
  poly = clip(poly, (p) => p[0] >= bb.xmin, (p, q) => ix(p, q, bb.xmin)); if (!poly.length) return poly;
  poly = clip(poly, (p) => p[0] <= bb.xmax, (p, q) => ix(p, q, bb.xmax)); if (!poly.length) return poly;
  poly = clip(poly, (p) => p[1] >= bb.ymin, (p, q) => iy(p, q, bb.ymin)); if (!poly.length) return poly;
  poly = clip(poly, (p) => p[1] <= bb.ymax, (p, q) => iy(p, q, bb.ymax));
  return poly;
}
function clippedPolyArea(rings, bb) {
  if (!rings.length) return 0;
  let a = ringArea(clipRingToBbox(rings[0], bb));
  for (let h = 1; h < rings.length; h++) a -= ringArea(clipRingToBbox(rings[h], bb));
  return Math.max(0, a);
}

// Place `want` references sampled from census population over the DEM bbox.
// Async + detached from placeRandomRefPoints (the sync QMC paths are unchanged).
async function placeCensusRefPoints(want) {
  const fail = (key, ...a) =>
    void (status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(t(key, ...a))}</span>`);
  if (!state.dem) return fail("census.no_dem");
  if (!state.dem.isGeographic) return fail("census.geographic");
  if (typeof flatgeobuf === "undefined") return fail("census.lib_missing");
  const bb = state.dem.bbox;     // {xmin,ymin,xmax,ymax} lon/lat
  if (bb.xmax < BRAZIL_BBOX.xmin || bb.xmin > BRAZIL_BBOX.xmax ||
      bb.ymax < BRAZIL_BBOX.ymin || bb.ymin > BRAZIL_BBOX.ymax)
    return fail("census.outside_brazil");
  if (state.censusInFlight) return;
  state.censusInFlight = true;
  const btn = document.getElementById("ref-place-random");
  if (btn) btn.disabled = true;
  status.textContent = t("census.fetching");
  try {
    // 1. Fetch setores intersecting the DEM bbox (HTTP Range over the .fgb).
    const rect = { minX: bb.xmin, minY: bb.ymin, maxX: bb.xmax, maxY: bb.ymax };
    const setores = [];          // { parts:[poly…], box:{minx…}, w }
    let totalW = 0;
    for await (const f of flatgeobuf.deserialize(CENSUS_FGB_URL, rect)) {
      const pop = +f?.properties?.pop;
      if (!Number.isFinite(pop) || pop <= 0) continue;
      const g = f.geometry;
      const parts = g?.type === "Polygon" ? [g.coordinates]
        : g?.type === "MultiPolygon" ? g.coordinates : null;
      if (!parts) continue;
      let full = 0, clip = 0;
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (const rings of parts) {
        full += polyArea(rings);
        clip += clippedPolyArea(rings, bb);
        for (const p of rings[0]) {
          if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
          if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
        }
      }
      if (full <= 0) continue;
      const w = pop * Math.min(1, clip / full);   // pop weighted by in-extent area
      if (!(w > 0)) continue;
      setores.push({ parts, box: { minx, miny, maxx, maxy }, w });
      totalW += w;
    }
    if (!setores.length || totalW <= 0) return fail("census.no_setores");

    // 2. Population-weighted setor selection: 1-D Sobol → inverse CDF.
    const cdf = new Float64Array(setores.length);
    let acc = 0;
    for (let i = 0; i < setores.length; i++) { acc += setores[i].w; cdf[i] = acc / totalW; }
    const searchsorted = (u) => {
      let lo = 0, hi = setores.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < u) lo = m + 1; else hi = m; }
      return lo;
    };

    // 3. Place each point inside its setor: 2-D Sobol bbox draw + PIP rejection.
    const posCtr = new Map();     // setor idx → its 2-D Sobol counter (continues)
    const coords = [];
    for (let k = 0; k < want; k++) {
      const si = searchsorted(sobolScalar1D(k + 1));
      const s = setores[si];
      const { minx, miny, maxx, maxy } = s.box;
      let ctr = posCtr.get(si) ?? 0, pt = null;
      for (let tries = 0; tries < 64; tries++) {
        const [qx, qy] = sobolPoint2D(++ctr);
        const lng = minx + qx * (maxx - minx);
        const lat = miny + qy * (maxy - miny);
        if (s.parts.some((rings) => pointInPolygon(lng, lat, rings))) { pt = [lng, lat]; break; }
      }
      posCtr.set(si, ctr);
      if (!pt) { const r0 = s.parts[0][0]; pt = [r0[0][0], r0[0][1]]; }  // sliver fallback
      coords.push(pt);
    }

    // 4. lng/lat → pixel → passable → reference point (reuses the file-load path).
    const constrained = networkConstraintActive();
    const valid = [];
    let skipped = 0;
    for (const [lng, lat] of coords) {
      let rc = latLngToPixel(L.latLng(lat, lng));
      if (rc && constrained) {
        rc = snapToNetwork(rc);
        if (!state.networkMask[rc[0] * state.dem.W + rc[1]]) rc = null;
      }
      if (rc && effectivePassableAt(rc[0] * state.dem.W + rc[1])) valid.push(rc);
      else skipped++;
    }
    if (!valid.length) return fail("census.no_points");   // refs left untouched
    clearRefPoints();             // census REPLACES the current set (like file load)
    for (const rc of valid) addRefPoint(rc);
    const placed = state.refPoints.length;
    // Population proxy for the accessibility KPIs: the refs were drawn
    // population-weighted from setores totalling totalW in-extent people, so
    // each placed ref represents refPopM/placed of them. Assigned AFTER the
    // addRefPoint loop (addRefPoint nulls it on every ref-set change).
    state.refPopM = placed > 0 ? totalW : null;
    status.textContent = skipped
      ? t("census.placed.skipped", placed, skipped)
      : t("census.placed", placed);
  } catch (err) {
    fail("census.fetch_failed", err?.message || String(err));
  } finally {
    state.censusInFlight = false;
    if (btn) btn.disabled = false;
  }
}

// Export the current reference points as a GeoJSON FeatureCollection (the
// inverse of loadRefPointsFromFile). Cells → lon/lat via pixelToLatLng; only
// works on a geographic DEM (same guard as the loader).
function exportRefPoints() {
  if (!state.refPoints || !state.refPoints.length) {
    status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(t("ref.export_empty"))}</span>`;
    return;
  }
  const features = [];
  for (let i = 0; i < state.refPoints.length; i++) {
    const ll = pixelToLatLng(state.refPoints[i][0], state.refPoints[i][1]);
    if (!ll) { status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(t("ref.load.geographic"))}</span>`; return; }
    features.push({ type: "Feature", properties: { index: i + 1 }, geometry: { type: "Point", coordinates: [ll.lng, ll.lat] } });
  }
  const blob = new Blob([JSON.stringify({ type: "FeatureCollection", features })], { type: "application/geo+json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "referencias.geojson";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  status.textContent = t("ref.export_done", features.length);
}

// Load reference points from a GeoJSON of Point / MultiPoint features. Each
// coordinate is converted to a DEM pixel via latLngToPixel and placed through
// addRefPoint (reusing its mask check / numbered marker / FIFO cap). Replaces
// the current reference set; points outside the extent or on nodata are
// skipped. Pairs with census/sample_census.py output.
async function loadRefPointsFromFile(file) {
  if (!file) return;
  const fail = (key, ...a) => {
    status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(t(key, ...a))}</span>`;
  };
  if (!state.dem) return fail("ref.load.no_dem");
  if (!state.dem.isGeographic) return fail("ref.load.geographic");
  let fc;
  try {
    fc = JSON.parse(await file.text());
  } catch (err) {
    return fail("ref.load.parse_error", err.message);
  }
  // Accept a FeatureCollection, a single Feature, or a bare geometry.
  const features = Array.isArray(fc?.features) ? fc.features
    : fc?.type === "Feature" ? [fc]
    : fc ? [{ geometry: fc.geometry || fc }] : [];
  const coords = [];
  for (const f of features) {
    const g = f?.geometry || f;
    if (g?.type === "Point") coords.push(g.coordinates);
    else if (g?.type === "MultiPoint") for (const c of g.coordinates) coords.push(c);
  }
  // GeoJSON coordinates are [lng, lat]. Keep only points inside the extent on a
  // passable cell; tally the rest so the load is never silently lossy.
  const valid = [];
  let skipped = 0;
  for (const [lng, lat] of coords) {
    const rc = latLngToPixel(L.latLng(lat, lng));
    if (rc && effectivePassableAt(rc[0] * state.dem.W + rc[1])) valid.push(rc);
    else skipped++;
  }
  if (!valid.length) return fail("ref.load.no_points", file.name);
  // Raise the N-references cap so the whole file survives the FIFO trim in
  // addRefPoint (input + worker top out at 2000; warn if we clip).
  const capInput = document.getElementById("n-refs");
  if (capInput) {
    capInput.value = String(Math.min(2000, Math.max(parseInt(capInput.value, 10) || 0, valid.length)));
  }
  if (valid.length > 2000) {
    console.warn(`[refs] ${valid.length - 2000} of ${valid.length} points dropped (2000 cap, FIFO).`);
  }
  clearRefPoints();
  for (const rc of valid) addRefPoint(rc);
  const placed = state.refPoints.length;
  status.textContent = skipped
    ? t("ref.loaded.skipped", placed, file.name, skipped)
    : t("ref.loaded", placed, file.name);
}

function syncRefDisplay() {
  const el = document.getElementById("ref-display");
  if (el) el.textContent = state.refPoints.length
    ? t("ref.count", state.refPoints.length)
    : t("ref.none");
  updateRunButtonState();
  estimateRunTime();
}

let statusClearTimer = null;
// Auto-dismiss a transient SUCCESS message after a few seconds so the floating
// pill doesn't park over the map indefinitely. Only clears if the text is still
// the same message (a newer status/compute write cancels the dismissal).
function scheduleStatusClear(msg) {
  clearTimeout(statusClearTimer);
  statusClearTimer = setTimeout(() => { if (status.textContent === msg) status.textContent = ""; }, 6000);
}

// Unified gate for the Compute button. In density mode it unlocks once at
// least one reference point exists; otherwise it follows the src/dst rules.
function updateRunButtonState() {
  if (!state.dem) {
    runBtn.disabled = true;
  } else {
    const densityOn = !!document.getElementById("want-density")?.checked;
    runBtn.disabled = densityOn
      ? !(state.refPoints && state.refPoints.length > 0)
      : !state.src;
  }
  // Explain the gate at the (disabled) button — title + status colours.
  runBtn.title = !runBtn.disabled ? ""
    : !state.dem ? t("compute.need_dem")
    : document.getElementById("want-density")?.checked ? t("compute.need_ref")
    : t("compute.need_src");
  syncLoadedHighlights(); // refresh 3B/3C/4 status colours
}

// ------- Run -------
runBtn.addEventListener("click", async () => {
  const wantDensity = !!document.getElementById("want-density")?.checked;
  // Density mode runs from refPoints, not src — relax the src-required guard.
  if (!state.dem) return;
  if (!wantDensity && !state.src) return;
  if (wantDensity && (!state.refPoints || state.refPoints.length === 0)) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.density_needs_ref")}</span>`;
    return;
  }
  // Mobile: close the drawer so the user sees the result land on the map
  // instead of staring at the parameter panel while the compute runs.
  // No-op on desktop (drawer never opens above 860 px).
  window.__simuDrawer?.close();

  const mode = document.getElementById("mode").value;
  // The v2 cost bundle derived from the physics inputs (readCost clamps each to a
  // sane range, so edge weights stay non-negative and the time estimate finite).
  const cost = readCost();
  const eMaxRaw = parseFloat(document.getElementById("e-max")?.value);
  let eMax = Number.isFinite(eMaxRaw) && eMaxRaw > 0 ? eMaxRaw : 0;
  // Round mode only: budget caps each leg ("leg", default — totals reach
  // 2·eMax) or the round-trip sum ("total").
  const eMaxMode = document.getElementById("e-max-mode")?.value || "leg";

  // Optional extras. Passes are ALWAYS computed since v68 (the "contagem de
  // passagens" checkbox was dropped — behaviour is identical to it being
  // permanently checked); the density branch ignores the flag as before.
  const wantPasses = true;
  const wantTopN   = !!document.getElementById("want-topn")?.checked;
  const nRoutes    = Math.max(1, Math.min(20, parseInt(document.getElementById("n-routes")?.value, 10) || 3));
  const penalty    = Math.max(0, parseFloat(document.getElementById("penalty")?.value) || 2.0);
  const repulsionMode = document.getElementById("repulsion-mode")?.value || "per-cell";
  // Reverse-optimization: flip the cost function so Dijkstra finds the
  // most expensive (under the original metric) routes rather than the
  // cheapest. The worker does the inversion against a precomputed
  // MAX_EDGE_COST = α·diagonal + β·(maxH − minH).
  // maximizeLength > 0 activates a length-constrained layered-DP path
  // search instead of the inverted Dijkstra. Memory-bounded; the worker
  // refuses if L·H·W exceeds the cap.
  const maximize       = !!document.getElementById("maximize")?.checked;
  const maximizeLength = Math.max(0, parseInt(document.getElementById("maximize-length")?.value, 10) || 0);
  // The budget is in REAL kJ, but under maximize every edge cost is INVERTED
  // against MAX_EDGE_COST (hundreds of kJ per edge) — a realistic budget
  // would prune the whole field to empty. The budget does not apply; forcing
  // 0 here covers every payload built below (baseMsg, backend, graph).
  if (maximize) eMax = 0;
  // Density follows the global Mode select instead of having its own
  // direction toggle.
  const densityMode  = mode;
  // Move directions (grid neighborhood, docs/grid-connectivity-sensitivity):
  // 8 = the classic engine and the ONLY value the native backend serves —
  // any other value computes in-browser (gated below, like top-N/maximize).
  // The worker forces 8 under maximize regardless (inversion degeneracy).
  const nDirsRaw = parseInt(document.getElementById("n-dirs")?.value, 10);
  const nDirs = [4, 8, 16, 32, 64, 128].includes(nDirsRaw) ? nDirsRaw : 8;
  // String pulling: post-hoc shortcutting of the displayed route(s).
  const stringPull = !!document.getElementById("string-pull")?.checked;

  if (wantTopN && !state.dst) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.topn_needs_dst")}</span>`;
    return;
  }

  // Whether the loaded network constrains THIS run (checkbox can disable
  // the constraint while keeping the network loaded for rendering).
  const constrainNet = networkConstraintActive();

  // If a constraining network is loaded, src/dst must lie on it — otherwise
  // the Dijkstra is constrained to network cells and can't relax through
  // them. Re-snap here defensively: covers the case where the user clicked
  // points BEFORE loading the .gpkg, and the case where snap-radius was 0
  // at click time. If a point can't be snapped (no network cell within
  // radius) we abort with a clear message rather than silently producing
  // empty routes.
  if (constrainNet && state.dem) {
    const W = state.dem.W;
    const offNet = (rc) => rc && !state.networkMask[rc[0] * W + rc[1]];
    const reSnapAndUpdate = (rc, marker, displayId, label) => {
      if (!rc || !offNet(rc)) return rc;
      const snapped = snapToNetwork(rc);
      if (offNet(snapped)) {
        // Snap is grid-wide now — this means the network has no usable
        // cells at all on this DEM.
        status.innerHTML = `<span style="color:#ff6b6b">${t("status.snap_failed_label", escapeHtml(label))}</span>`;
        return null;
      }
      // Move the marker so the user sees where compute actually started.
      const { originX, originY, dx, dy } = state.dem;
      const latlng = L.latLng(originY - (snapped[0] + 0.5) * dy, originX + (snapped[1] + 0.5) * dx);
      if (marker) marker.setLatLng(latlng);
      const disp = document.getElementById(displayId);
      if (disp) {
        disp.textContent = `r=${snapped[0]}, c=${snapped[1]}`;
        disp.classList.add("set");
      }
      return snapped;
    };
    // Gate each point on its existence: state.src is ALWAYS null in
    // density mode, and the old unconditional call returned that null
    // through `if (newSrc === null) return;` — silently aborting every
    // density compute whenever a constraining network was loaded.
    if (state.src) {
      const newSrc = reSnapAndUpdate(state.src, state.srcMarker, "src-display", t("marker.src"));
      if (newSrc === null) return;
      state.src = newSrc;
    }
    if (state.dst) {
      const newDst = reSnapAndUpdate(state.dst, state.dstMarker, "dst-display", t("marker.dst"));
      if (newDst === null) return;
      state.dst = newDst;
    }
    // Density refs get the same defensive re-snap: refs placed before the
    // network loaded (or via random placement over the whole DEM) may sit
    // off-network; their per-ref Dijkstras would start from isolated
    // seeds. Markers follow their snapped cells.
    if (wantDensity && state.refPoints?.length) {
      for (let i = 0; i < state.refPoints.length; i++) {
        const rc = state.refPoints[i];
        if (!offNet(rc)) continue;
        const snapped = snapToNetwork(rc);
        if (offNet(snapped)) {
          status.innerHTML = `<span style="color:#ff6b6b">${t("status.refs_no_snap")}</span>`;
          return;
        }
        state.refPoints[i] = snapped;
        const m = state.refMarkers[i];
        if (m) {
          const ll = pixelToLatLng(snapped[0], snapped[1]);
          if (ll) m.setLatLng(ll);
          m.unbindTooltip().bindTooltip(`ref ${i + 1} · r=${snapped[0]}, c=${snapped[1]}`);
        }
      }
    }
  }

  // Cancel any in-flight run, then capture this run's generation. Every
  // worker callback below checks it — a mismatch means the run was
  // superseded (new Compute click, new DEM/network) and the message is
  // dropped instead of rendered against the wrong grid.
  cancelActiveCompute();
  const gen = state.computeGen;

  status.textContent = t("status.computing");
  progress.classList.add("active");
  progressBar.style.width = "0%";
  runBtn.disabled = true;

  // ETA bookkeeping. The worker emits progress every ~N/50 cells, which
  // gives a usable ETA after the first few percent.
  state.computeStartedAt = performance.now();
  state.estimatedTotalMs = 0;
  syncLoadedHighlights(); // 3C → running (orange)
  // Cache density's expected ref count so the progress text reads
  // "ref X/N" while the workers are iterating.
  state.computeRefTotal = wantDensity ? state.refPoints.length : 0;

  const { H, W } = state.dem;
  const N = H * W;
  // Snapshot the run config now (engine/refs/budget/mode) so computeDone can
  // online-correct the estimate against the real elapsed time.
  if (state.calibration) state.lastRun = currentRunOpts(state.calibration, N);
  const wantNetworkInterp = !!document.getElementById("net-interp")?.checked;
  const interpMaxDistance = Math.max(1, parseInt(document.getElementById("net-interp-max-dist")?.value, 10) || 50);
  const interpSmoothing   = Math.max(0, parseInt(document.getElementById("net-interp-smoothing")?.value, 10) || 0);

  const computeFailed = (message) => {
    if (gen !== state.computeGen) return;
    cancelActiveCompute();
    // Falha de cálculo na nuvem: para a VM agora em vez de deixá-la ligada até o
    // watchdog de ócio da VM desligar sozinho (cancelActiveCompute só corta o
    // keepalive local — que é só uma flag, não há lease no orquestrador).
    // computeDone faz o mesmo no sucesso; stopCloudVm é idempotente.
    if (state.cloud.mode === "cloud" && state.cloud.orchestratorUrl) {
      stopCloudVm(state.cloud.orchestratorUrl);
    }
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.worker_error", escapeHtml(message))}</span>`;
  };

  const computeDone = (m) => {
    if (gen !== state.computeGen) return;
    // Terminate now rather than waiting for the next run — finished
    // workers pin their DEM copy + Dijkstra buffers otherwise.
    for (const w of state.workers) w.terminate();
    state.workers = [];
    progress.classList.remove("active");
    updateRunButtonState();
    state.computeStartedAt = 0;
    stampBridgeDeckPasses(m.passes); // deck cells carry the bridge flow (portals skip them)
    // Snapshot the run's OWN mode — the #mode select isn't disabled mid-run,
    // so reading it live in renderResult would mislabel a result if the user
    // changed it while this compute was in flight (see the round_note gate).
    m.runMode = mode;
    renderResult(m);
    status.textContent = t("status.done_ms", m.elapsedMs.toFixed(0));
    scheduleStatusClear(status.textContent);
    setGroupOpen("result-group", true); // compute done → reveal results
    syncLoadedHighlights();              // 3C → done (green), 4 → ready (orange)
    // Learn from this run: nudge the estimate toward reality (single runs
    // only — compare runs carry energyAlt and time ~2 scenarios). Compute and
    // interp phases are corrected separately (m.computeMs/m.interpMs when the
    // density path split them; else the whole run is compute). Then refresh
    // the pre-flight number so the correction is visible immediately.
    if (!m.energyAlt) {
      updateEstimateCorrection(m.computeMs ?? m.elapsedMs, m.interpMs ?? 0);
      estimateRunTime();
    }
    // The calibration probe is skipped while a compute runs — if this DEM
    // still has no calibration, run it now that the cores are free.
    if (!state.calibration) startCalibrationProbe();
    // Cloud: stop the VM after each run (default-ON) so it doesn't bill idle.
    // With "keep warm" ticked, leave the VM up to reuse on the next run — just
    // drop the keepalive (a client-side in-flight flag; /cloud/keepalive is a
    // no-op on the orchestrator) so the in-VM idle-watchdog reaps it after ~15
    // min idle (the keepalive is also cleared inside stopCloudVm).
    if (state.cloud.mode === "cloud" && state.cloud.orchestratorUrl) {
      if (document.getElementById("cloud-keep-warm")?.checked) {
        stopCloudKeepalive();
        setCloudHint("cloud.warm");
      } else {
        stopCloudVm(state.cloud.orchestratorUrl);
      }
    }
  };

  const reportProgress = (frac) => {
    if (gen !== state.computeGen) return;
    const pct = Math.min(100, frac * 100);
    progressBar.style.width = `${pct.toFixed(1)}%`;
    // Live ETA: linear extrapolation. Skip the noisy first 5% of the run.
    if (frac > 0.05) {
      const elapsed = performance.now() - state.computeStartedAt;
      const total = elapsed / frac;
      const remaining = Math.max(0, total - elapsed);
      let label;
      if (state.computeRefTotal > 0) {
        const cur = Math.max(1, Math.min(state.computeRefTotal, Math.ceil(frac * state.computeRefTotal)));
        label = t("status.density_progress", cur, state.computeRefTotal, pct.toFixed(0));
      } else {
        label = t("status.computing_pct", pct.toFixed(0));
      }
      status.textContent = t("status.time_left", label, formatDuration(remaining));
    }
  };

  // A worker-load failure (404, parse error) or an exception outside the
  // worker's own try/catch surfaces as an `error` event, not a message —
  // without these handlers the UI used to stay stuck on "Computing…".
  const spawnWorker = (onMessage) => {
    const w = new Worker(WORKER_URL);
    w.onmessage = (ev) => { if (gen === state.computeGen) onMessage(ev.data); };
    w.onerror = (e) => computeFailed(e.message || "worker failed to load or crashed");
    w.onmessageerror = () => computeFailed("worker message could not be deserialised");
    state.workers.push(w);
    return w;
  };

  // Per-worker DEM clones — buffers are transferred, so each worker needs
  // its own copy. The pool sizing below accounts for this memory.
  const demPayload = () => {
    // buildComputeGrid composes the impassable mask + bridge corridors into the
    // height/mask; networkMask stays the separate constraint slot the worker ANDs.
    const { height, mask, transfer } = buildComputeGrid();
    const networkMask = constrainNet ? new Uint8Array(state.networkMask) : null;
    if (networkMask) transfer.push(networkMask.buffer);
    return { height, mask, networkMask, transfer };
  };

  // ---- Accessibility KPI inputs (density only) -----------------------------
  // The density engines sample each ref's energy field at every ref cell,
  // returning the pairwise K×K matrix the KPI block evaluates. Suppressed
  // under maximize (inverted costs) and graph mode (raster refs only).
  const wantMatrix = wantDensity && !maximize && !graphModeActive();
  const matrixCells = wantMatrix
    ? Int32Array.from(state.refPoints, ([r, c]) => r * W + c)
    : null;
  // Snapshot the refs (+ lat/lng for the CSV export) and the census
  // population proxy NOW — the user can edit refs while the run is in
  // flight, and the matrix rows are keyed to the refs it ran with.
  const kpiSnapshot = wantMatrix ? {
    refs: state.refPoints.map(([r, c]) => {
      const ll = pixelToLatLng(r, c);
      return { r, c, lat: ll ? ll.lat : null, lng: ll ? ll.lng : null };
    }),
    popM: state.refPopM,
    eMax, eMaxMode, mode: densityMode,
  } : null;

  const portals = buildPortals();
  const baseMsg = {
    kind: "run",
    H, W,
    dx: state.dem.dxM,
    dy: state.dem.dyM,
    seedR: state.src ? state.src[0] : (state.refPoints[0] ? state.refPoints[0][0] : -1),
    seedC: state.src ? state.src[1] : (state.refPoints[0] ? state.refPoints[0][1] : -1),
    goalR: state.dst ? state.dst[0] : -1,
    goalC: state.dst ? state.dst[1] : -1,
    mode, cost, eMax, eMaxMode,
    wantPasses, wantTopN, nRoutes, penalty, repulsionMode,
    wantDensity,
    refPoints: wantDensity ? state.refPoints.slice() : null,
    densityMode,
    wantNetworkInterp,
    interpMaxDistance,
    interpSmoothing,
    maximize,
    maximizeLength,
    nDirs,
    stringPull,
    // Bridge portal edges (hybrid raster overlay). Small arrays — spread into
    // every worker message via baseMsg (structured-cloned, NOT transferred, so
    // the shared arrays survive across the density pool's workers). The native
    // backend path appends them to its Blob separately.
    portalU: portals ? portals.u : null,
    portalV: portals ? portals.v : null,
    portalLenM: portals ? portals.lenM : null,
    portalHU: portals ? portals.hu : null,   // deck-end ele (NaN = use DEM)
    portalHV: portals ? portals.hv : null,
  };

  // Shared tail for the density paths (pool and native backend): optional
  // IDW fill as a follow-up worker task (the fill helpers live in the
  // worker; per-slice filling would be wrong), then computeDone.
  // ---- Pooled network interpolation -----------------------------------------
  // The IDW fill is embarrassingly parallel by rows: split the grid into
  // bands across the worker pool (each band worker gets the FULL inputs —
  // rays read past band edges — so memory is ~6 bytes/cell per worker,
  // capped). Smoothing can't be banded (it would seam at band edges), so
  // it runs as one cheap full-grid pass after the merge. Resolves with the
  // filled field; failures go through computeFailed (promise stays pending,
  // the generation bump kills the chain).
  const runInterp = (energy) => new Promise((resolve) => {
    status.textContent = t("status.interpolating_net");
    progressBar.style.width = "0%";
    const interpPayload = () => ({
      // Effective mask (impassable blocked, corridors open) so IDW energy never
      // bleeds across water; networkMask stays the fill seed.
      mask: buildComputeGrid({ maskOnly: true }).mask,
      networkMask: new Uint8Array(state.networkMask),
    });
    const smoothThenResolve = (filled) => {
      if (!(interpSmoothing > 0)) { resolve(filled); return; }
      const { mask, networkMask } = interpPayload();
      const w = spawnWorker((m) => {
        if (m.kind === "smooth-done") resolve(m.energy);
        else if (m.kind === "error") computeFailed(m.message);
      });
      w.postMessage(
        { kind: "smooth", energy: filled, networkMask, mask, H, W, iters: interpSmoothing },
        [filled.buffer, mask.buffer, networkMask.buffer],
      );
    };
    // Pool sizing lives in interpPoolSize — shared with the time estimate
    // (predictInterpMs) so runner and estimator can never drift.
    const P = interpPoolSize(N, H);
    if (P <= 1) {
      // Single worker — smoothing handled worker-side in the same job.
      const { mask, networkMask } = interpPayload();
      const w = spawnWorker((m) => {
        if (m.kind === "progress") {
          progressBar.style.width = `${Math.min(100, m.progress * 100).toFixed(1)}%`;
        } else if (m.kind === "interp-done") resolve(m.energy);
        else if (m.kind === "error") computeFailed(m.message);
      });
      w.postMessage(
        {
          kind: "interp", energy, networkMask, mask, H, W,
          dx: state.dem.dxM, dy: state.dem.dyM,
          interpMaxDistance, interpSmoothing,
        },
        [energy.buffer, mask.buffer, networkMask.buffer],
      );
      return;
    }
    const merged = new Float32Array(N);
    const frac = new Float64Array(P);
    let remaining = P;
    for (let p = 0; p < P; p++) {
      const r0 = Math.floor(p * H / P);
      const r1 = Math.floor((p + 1) * H / P);
      const slot = p;
      const w = spawnWorker((m) => {
        if (m.kind === "progress") {
          frac[slot] = m.progress;
          let acc = 0;
          for (let i = 0; i < P; i++) acc += frac[i];
          progressBar.style.width = `${Math.min(100, (acc / P) * 100).toFixed(1)}%`;
        } else if (m.kind === "interp-done") {
          merged.set(m.energy, m.rowStart * W);
          frac[slot] = 1;
          if (--remaining === 0) smoothThenResolve(merged);
        } else if (m.kind === "error") computeFailed(m.message);
      });
      const eCopy = new Float32Array(energy);
      const { mask, networkMask } = interpPayload();
      w.postMessage(
        {
          kind: "interp", energy: eCopy, networkMask, mask, H, W,
          dx: state.dem.dxM, dy: state.dem.dyM,
          interpMaxDistance, rowStart: r0, rowEnd: r1,
        },
        [eCopy.buffer, mask.buffer, networkMask.buffer],
      );
    }
  });

  const finishDensityOutputs = (energy, density, alt, src) => {
    // Split the two phases so the online correction learns them independently
    // (interp often dominates a network-constrained run).
    const computeMs = performance.now() - state.computeStartedAt;
    const finalize = (energyOut, interpMs) => computeDone({
      energy: energyOut, passes: density,
      path: null, pathEnergy: null, pathLengthM: null, routes: null,
      elapsedMs: performance.now() - state.computeStartedAt,
      computeMs, interpMs: interpMs || 0,
      energyAlt: alt?.energyAlt || null,
      passesAlt: alt?.passesAlt || null,
      // Accessibility matrix + the refs/population snapshot it was run with.
      matrix: src?.matrix || null,
      matrixOutdated: !!src?.matrixOutdated,
      kpi: kpiSnapshot,
    });
    if (wantNetworkInterp && constrainNet) {
      const t = performance.now();
      runInterp(energy).then((e) => finalize(e, performance.now() - t));
    } else finalize(energy, 0);
  };

  // ---- Density worker pool -------------------------------------------------
  // Each reference point's Dijkstra is independent, so density runs split
  // the refs across min(cores − 1, K, memory-cap) workers — near-linear
  // wall-clock speedup. Workers return raw accumulators (densityPartial);
  // the merge + final normalisation happens here.
  //
  // Memory cap: each worker's resident set is the DEM copy (height f32 4 +
  // mask u8 1 = 5 B/cell) + densityField scratch (E4 + settled1 + parents4 +
  // order4 + passes-f32 4 = 17) + outputs (density-f32 4 + energySum-f64 8 +
  // energyCount 4 = 16) ≈ 38 B/cell, and ~55 in round mode (a second
  // search resident). Budget it against navigator.deviceMemory (GB, which
  // the spec CAPS at 8 — it's a floor on true RAM, never the full amount),
  // taking a conservative fraction to leave room for the browser, the
  // main-thread DEM, and the OS. On huge DEMs this still yields 1 worker
  // (the honest ceiling: two won't fit), exactly the old behaviour.
  const K = wantDensity ? state.refPoints.length : 0;
  const poolN = wantDensity ? densityPoolSize({ N, K, round: densityMode === "round", nDirs }) : 1;

  // Run one full density field over the worker pool and resolve with the
  // raw outputs (no interp, no UI finalisation — the callers compose those).
  // useNetwork toggles the network constraint per scenario, which is what
  // the constrained-vs-unconstrained comparison varies. Progress maps into
  // [progressBase, progressBase + progressScale].
  const computeDensityField = ({ useNetwork, progressBase = 0, progressScale = 1, wantMatrix: sliceMatrix = false }) =>
    new Promise((resolve) => {
      const density = new Float64Array(N);
      const energySum = new Float64Array(N);
      const energyCount = new Int32Array(N);
      // Pairwise accessibility matrix, assembled from each slice's rows at
      // its ref offset (rows are disjoint — merge order is irrelevant,
      // unlike the f64 accumulators above).
      const matrix = (sliceMatrix && matrixCells) ? new Float32Array(K * K).fill(Infinity) : null;
      const workerFrac = new Float64Array(poolN);
      const sliceLen = new Float64Array(poolN);
      let remaining = poolN;

      const poolProgress = () => {
        let acc = 0;
        for (let i = 0; i < poolN; i++) acc += workerFrac[i] * sliceLen[i];
        reportProgress(progressBase + progressScale * (acc / K));
      };

      for (let p = 0; p < poolN; p++) {
        const lo = Math.floor(p * K / poolN);
        const hi = Math.floor((p + 1) * K / poolN);
        sliceLen[p] = hi - lo;
        const slot = p;
        const w = spawnWorker((m) => {
          if (m.kind === "progress") {
            workerFrac[slot] = m.progress;
            poolProgress();
          } else if (m.kind === "done") {
            for (let i = 0; i < N; i++) density[i] += m.density[i];
            for (let i = 0; i < N; i++) energySum[i] += m.energySum[i];
            for (let i = 0; i < N; i++) energyCount[i] += m.energyCount[i];
            if (matrix && m.matrix) matrix.set(m.matrix, lo * K);
            workerFrac[slot] = 1;
            poolProgress();
            // This slice's worker is done — terminate it now rather than
            // leaving it resident until the next cancelActiveCompute()/
            // computeDone() (same rationale as computeDone's terminate loop):
            // a finished pool worker still pins its DEM copy + Dijkstra
            // buffers, which stacks on top of the NEXT pool (compare's
            // scenario B, or the post-merge interp pool) otherwise.
            w.terminate();
            const ix = state.workers.indexOf(w);
            if (ix >= 0) state.workers.splice(ix, 1);
            if (--remaining === 0) {
              // Second density normalisation (per-ref /N happened worker-side).
              for (let i = 0; i < N; i++) density[i] /= N;
              const energy = new Float32Array(N);
              for (let i = 0; i < N; i++) {
                energy[i] = energyCount[i] > 0 ? energySum[i] / energyCount[i] : Infinity;
              }
              resolve({ energy, passes: density, matrix });
            }
          } else if (m.kind === "error") {
            computeFailed(m.message);
          }
        });
        const { height, mask, transfer } = buildComputeGrid();
        const networkMask = useNetwork ? new Uint8Array(state.networkMask) : null;
        if (networkMask) transfer.push(networkMask.buffer);
        w.postMessage(
          {
            ...baseMsg,
            height, mask, networkMask,
            refPoints: state.refPoints.slice(lo, hi),
            densityPartial: true,
            // Accessibility matrix: each slice samples its refs' fields at
            // ALL K ref cells (matrixCells is structured-cloned, shared
            // read-only across the pool — like the portal arrays).
            wantMatrix: !!matrix,
            matrixCells: matrix ? matrixCells : null,
            // Interp (if any) runs after the merge, never per-slice.
            wantNetworkInterp: false,
          },
          transfer,
        );
      }
    });

  const startSingleWorker = () => {
    // Single worker: regular from/to/round runs, top-N, maximize, and
    // density with one ref (or when memory caps the pool at 1).
    const w = spawnWorker((m) => {
      if (m.kind === "progress") {
        reportProgress(m.progress);
      } else if (m.kind === "done") {
        computeDone(m);
      } else if (m.kind === "error") {
        computeFailed(m.message);
      } else if (m.kind === "warning") {
        // Non-fatal — the worker is still going and will follow up with
        // a `done` message. Yellow-tint the status; the next progress
        // tick will overwrite it.
        console.warn("[worker]", m.message);
        status.innerHTML = `<span style="color:#ffb86b">${escapeHtml(workerWarningText(m))}</span>`;
      }
    });
    const { height, mask, networkMask, transfer } = demPayload();
    w.postMessage({ ...baseMsg, height, mask, networkMask }, transfer);
  };

  // ---- Optional native backend (density only, OFF by default) --------------
  // Sends the DEM + params to the local Rust server (backend/ in the repo)
  // which runs the per-ref Dijkstras on all cores. Any failure — server not
  // running, version mismatch, network error — falls back to the in-browser
  // pool. Protocol documented in backend/src/main.rs.
  const startDensityBackend = async (baseUrl, { useNetwork, wantMatrix: sliceMatrix = false }) => {
    progressBar.style.width = "10%"; // no streaming progress from the backend
    // Liveness ticker: large runs take a while server-side and fetch gives
    // no progress events — an elapsed counter shows the app isn't hung.
    const t0 = performance.now();
    status.textContent = t(cloudMode ? "status.cloud_computing" : "status.backend_computing");
    const ticker = setInterval(() => {
      if (gen !== state.computeGen) { clearInterval(ticker); return; }
      status.textContent = t(
        cloudMode ? "status.cloud_computing_elapsed" : "status.backend_computing_elapsed",
        formatDuration(performance.now() - t0));
    }, 1000);
    try {
      const params = {
        h: H, w: W,
        dx: state.dem.dxM, dy: state.dem.dyM,
        cost, eMax, eMaxMode,
        densityMode,
        refPoints: state.refPoints.map(([r, c]) => [r, c]),
        hasNetwork: useNetwork,
        maximize,
        // Bridge portal edges appended after the (optional) network mask, in
        // order: portalU (i32×P), portalV (i32×P), portalLenM (f64×P),
        // portalHU (f64×P), portalHV (f64×P). HU/HV are deck-end ele (NaN=use DEM).
        nPortals: portals ? portals.n : 0,
        // Accessibility matrix: the backend samples ref cells itself from
        // refPoints (no matrixCells on the wire) and appends f32×K² after
        // the energy field, announcing it with "matrix":K in the meta. An
        // older binary ignores the flag — detected below via the meta.
        wantMatrix: !!sliceMatrix,
        // Move set (backend ≥ 0.2.0; dispatch is version-gated — an older
        // binary would silently ignore this field and compute 8 directions).
        nDirs,
      };
      const json = new TextEncoder().encode(JSON.stringify(params));
      const head = new Uint8Array(4);
      new DataView(head.buffer).setUint32(0, json.length, true);
      // Compose the impassable mask + bridge corridors into the grid the native
      // backend computes on (sent as raw bytes — parity kept).
      const { height: gridHeight, mask: gridMask } = buildComputeGrid();
      const body = new Blob([
        head, json, gridHeight, gridMask,
        ...(useNetwork ? [state.networkMask] : []),
        ...(portals ? [portals.u, portals.v, portals.lenM, portals.hu, portals.hv] : []),
      ]);
      const resp = await fetch(`${baseUrl}/density`, { method: "POST", body, headers: cloudComputeHeaders() });
      if (!resp.ok) throw new Error(`backend HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      if (gen !== state.computeGen) return new Promise(() => {});

      // From here on the backend HAS answered — a parsing/allocation error
      // must surface as a failure, NOT fall through to the browser-pool
      // fallback (silently recomputing a huge DEM there looks like a hang).
      try {
        const dv = new DataView(buf);
        const jlen = dv.getUint32(0, true);
        // Meta JSON (padded with trailing spaces — legal JSON whitespace).
        // "matrix":K announces the appended f32×K² accessibility matrix; an
        // older backend that predates the field simply omits it.
        let respMeta = {};
        try {
          respMeta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, jlen)));
        } catch { /* tolerate unparseable meta — fall through to length check */ }
        const mk = respMeta.matrix | 0;
        const expect = 4 + jlen + 8 * N + 4 * N + 4 * mk * mk;
        if (buf.byteLength !== expect) {
          throw new Error(`backend response ${buf.byteLength} B, expected ${expect} B`);
        }
        let off = 4 + jlen;
        // Always slice-copy: a zero-copy VIEW over the response buffer would
        // keep the WHOLE response (header + JSON + density + energy) reachable
        // for the lifetime of the result (state.lastResult.passes), doubling
        // up the 4·N energy bytes (once here, once inside `buf`) — ~540 MB of
        // dead weight on the 135 M-cell target. The transient +8·N copy cost
        // is worth not retaining the 12·N response buffer.
        const density = new Float64Array(buf.slice(off, off + 8 * N));
        off += 8 * N;
        // Energy is always copied out: downstream steps (interp) transfer
        // it to workers, and a view would drag the whole response buffer —
        // density included — along and detach it.
        const energy = new Float32Array(buf.slice(off, off + 4 * N));
        off += 4 * N;
        // Slice-copied like the fields above (a view would pin the whole
        // response). mk===0 with sliceMatrix requested ⇒ the backend binary
        // predates the matrix — degrade to "KPI unavailable", never fail
        // (and never fall back to the browser: the fields are good).
        const matrix = mk > 0 ? new Float32Array(buf.slice(off, off + 4 * mk * mk)) : null;
        if (sliceMatrix && !matrix) console.warn("[backend] no accessibility matrix in response — backend predates the feature");
        progressBar.style.width = "100%";
        return { energy, passes: density, matrix, matrixOutdated: !!(sliceMatrix && !matrix) };
      } catch (err) {
        console.error("[backend] response handling failed:", err);
        computeFailed(`backend response handling failed: ${err.message}`);
        return new Promise(() => {}); // run is dead; keep the chain pending
      }
    } finally {
      clearInterval(ticker);
    }
  };

  // ---- Optional native backend: single-source energy field ------------------
  // POST /single — one Dijkstra (two for round) on the native server, returning
  // the raw energy field + optional passes. Maximize/top-N/path stay browser-
  // only (the backend produces no routes), so the caller only reaches here for
  // the plain from/to/round energy field. Throws on any failure → browser
  // fallback (a 404 from an old backend without /single lands here too).
  const startSingleBackend = async (baseUrl) => {
    progressBar.style.width = "10%"; // no streaming progress from the backend
    const t0 = performance.now();
    status.textContent = t(cloudMode ? "status.cloud_computing" : "status.backend_computing");
    const ticker = setInterval(() => {
      if (gen !== state.computeGen) { clearInterval(ticker); return; }
      status.textContent = t(
        cloudMode ? "status.cloud_computing_elapsed" : "status.backend_computing_elapsed",
        formatDuration(performance.now() - t0));
    }, 1000);
    try {
      const params = {
        h: H, w: W,
        dx: state.dem.dxM, dy: state.dem.dyM,
        cost, eMax, eMaxMode,
        densityMode: mode,                 // from | to | round (single-source dir)
        src: [state.src[0], state.src[1]],
        wantPasses,
        hasNetwork: constrainNet,
        maximize: false,                   // excluded from the single-source path
        nPortals: portals ? portals.n : 0,
        // Move set (backend ≥ 0.2.0; dispatch is version-gated).
        nDirs,
      };
      const json = new TextEncoder().encode(JSON.stringify(params));
      const head = new Uint8Array(4);
      new DataView(head.buffer).setUint32(0, json.length, true);
      const { height: gridHeight, mask: gridMask } = buildComputeGrid();
      const body = new Blob([
        head, json, gridHeight, gridMask,
        ...(constrainNet ? [state.networkMask] : []),
        ...(portals ? [portals.u, portals.v, portals.lenM, portals.hu, portals.hv] : []),
      ]);
      const resp = await fetch(`${baseUrl}/single`, { method: "POST", body, headers: cloudComputeHeaders() });
      if (!resp.ok) throw new Error(`backend HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      if (gen !== state.computeGen) return new Promise(() => {});
      try {
        const dv = new DataView(buf);
        const jlen = dv.getUint32(0, true);
        // v49 shipped /single passes as f64 (subtree_passes_f64, counts exceed
        // 2^24 on big DEMs). A pre-v49 backend binary (stale self-hosted build,
        // or the cloud VM's boot-disk-cached binary — see vm/startup-script.sh)
        // still answers with f32 passes. Accept both layouts, mirroring the
        // /density decoder's old-backend tolerance, rather than hard-failing.
        const expectF64 = 4 + jlen + 4 * N + (wantPasses ? 8 * N : 0);
        const expectF32 = 4 + jlen + 4 * N + (wantPasses ? 4 * N : 0);
        let passesAreF32 = false;
        if (buf.byteLength === expectF64) {
          // current layout
        } else if (wantPasses && buf.byteLength === expectF32) {
          passesAreF32 = true;
          console.warn("[backend] pre-v49 backend detected: /single passes received as f32 — rebuild the backend (cargo build --release) for exact counts above 2^24");
        } else {
          throw new Error(`backend response ${buf.byteLength} B, expected ${expectF64} B`);
        }
        let off = 4 + jlen;
        // Slice-copy (a single search, so the copy is cheap and the views need
        // no alignment): f32 energy first, then passes when present.
        const energy = new Float32Array(buf.slice(off, off + 4 * N));
        off += 4 * N;
        const passes = wantPasses
          ? (passesAreF32
              ? Float64Array.from(new Float32Array(buf.slice(off, off + 4 * N)))
              : new Float64Array(buf.slice(off, off + 8 * N)))
          : null;
        progressBar.style.width = "100%";
        return { energy, passes };
      } catch (err) {
        console.error("[backend] single response handling failed:", err);
        computeFailed(`backend response handling failed: ${err.message}`);
        return new Promise(() => {}); // run is dead; keep the chain pending
      }
    } finally {
      clearInterval(ticker);
    }
  };

  // Backend with browser-pool fallback, per scenario. Resolves with raw
  // {energy, passes} like computeDensityField.
  const densityField = async (opts) => {
    // nDirs ≠ 8 needs backend ≥ 0.2.0 (the move-set port). Cloud enters
    // optimistically (version only known post-boot) and the in-try check
    // throws a reason-ful error an OLD binary — the shared catch below turns
    // it into the no-fallback abort or the browser fallback with motivo.
    if (runUseBackend && (nDirs === 8 || cloudMode || backendServesNDirs())) {
      try {
        if (nDirs !== 8 && !backendServesNDirs()) {
          throw new Error(t("cloud.backend_old_ndirs",
                            (state.backendCores && state.backendCores.version) || "?", nDirs));
        }
        return await startDensityBackend(computeDataUrl(), opts);
      } catch (err) {
        if (gen !== state.computeGen) return new Promise(() => {});
        // "Falhar em vez de cair pro navegador": abort loudly (computeFailed
        // also stops the VM) instead of silently recomputing on the laptop.
        if (cloudMode && cloudNoFallback()) {
          computeFailed(t("cloud.failed_hard", err?.message || String(err)));
          return new Promise(() => {}); // run is dead; keep the chain pending
        }
        console.warn("[backend] falling back to in-browser workers:", err);
        // Surface the REASON in the status line, not just the console — a
        // silent fallback reads as "the cloud just didn't run" (visto na
        // prática). err.message is our own fetch/HTTP wording, not user data.
        status.textContent = t(cloudMode ? "cloud.preempted" : "status.backend_fallback",
                               err?.message || String(err));
        // This run is now executing on the browser pool, not the backend.
        // Re-tag it so computeDone's online correction trains corrBrowser
        // (actual/predicted vs the browser model), not corrBackend — otherwise
        // every fallback run corrupts the native-slice correction with
        // browser timings and leaves corrBrowser untrained.
        if (state.lastRun) state.lastRun.backend = false;
      }
    }
    return computeDensityField(opts);
  };

  // ---- Constrained vs unconstrained comparison ------------------------------
  // Two full-grid single-source workers: the primary run exactly as
  // configured (network mask, passes, top-N, path, interp), plus a secondary
  // run WITHOUT the network (energy + passes when enabled). The energy
  // difference (constrained − unconstrained, clamped at 0 — a constraint can
  // never reduce cost) quantifies what the network costs in energy; it's
  // defined on network cells only (off-network constrained values are interp
  // visualisation, not analysis). Passes difference is signed: positive
  // where the network concentrates traffic, negative where unconstrained
  // corridors ran.
  //
  // Each worker's resident set (height+mask+E+settled+parents+order+passes,
  // ~26-40 B/cell) is comparable to a density-pool worker's, but nothing
  // budgeted the pair — run BOTH in parallel only when that fits the SAME
  // conservative budget the density/interp pools use (38/55 B/cell are
  // densityPoolSize's constants; slightly conservative here, which is fine).
  // Otherwise run wB only after wA's buffers are actually released
  // (terminated), so the two full-grid workers are never resident together —
  // peak memory halves at the cost of serialized wall time.
  const startComparePair = () => {
    let primary = null, secondary = null;
    const maybeFinish = async () => {
      if (!primary || !secondary) return;
      // The difference is ANALYSED on network cells only (off-network
      // constrained values are interpolation, not analysis), then — when
      // the interp option is on — visually filled across non-network
      // cells exactly like the constrained field.
      const net = state.networkMask;
      let diff = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        if (net && !net[i]) { diff[i] = Infinity; continue; }
        const a = primary.energy[i], b = secondary.energy[i];
        diff[i] = (Number.isFinite(a) && Number.isFinite(b)) ? Math.max(0, a - b) : Infinity;
      }
      if (wantNetworkInterp && constrainNet) {
        diff = await runInterp(diff);
        if (gen !== state.computeGen) return;
      }
      primary.energyAlt = { unconstrained: secondary.energy, difference: diff };
      if (primary.passes && secondary.passes) {
        primary.passesAlt = { unconstrained: secondary.passes };
      }
      // The secondary now also traces the unconstrained best TERRAIN route (only
      // when a destination is set) → the compare route view's blue line.
      if (secondary.path && secondary.path.length) {
        primary.pathAlt = secondary.path;
        primary.pathAltEnergy = secondary.pathEnergy ?? null;
        primary.pathAltLengthM = secondary.pathLengthM ?? null;
      }
      computeDone(primary);
    };
    const perWorker = (mode === "round" ? 55 : 38) * N;
    const parallelOk = 2 * perWorker <= memBudgetBytes();
    // Progress: in the parallel case only the primary reports (unchanged
    // behaviour). In the sequential case wA and wB each cover half the bar —
    // without this, wB's run (roughly as long as wA's, on exactly the huge
    // DEMs this fix targets) would leave the bar sitting at ~100% with zero
    // feedback for the whole second pass.
    const startSecondary = (opts = {}) => {
      const { progressBase = 0, progressScale = 1 } = opts;
      const wB = spawnWorker((m) => {
        if (m.kind === "progress") {
          if (progressBase || progressScale !== 1) reportProgress(progressBase + progressScale * m.progress);
        } else if (m.kind === "done") { secondary = m; maybeFinish(); }
        else if (m.kind === "error") computeFailed(m.message);
      });
      // No network — same mode/cost/budget; passes mirror the primary so the
      // overlay is comparable across scenarios. Bridges are terrain, so the
      // composed grid applies here too (only the networkMask constraint slot
      // differs from the primary). We KEEP baseMsg's goalR/goalC so the
      // unconstrained partner ALSO traces the best TERRAIN route to the
      // destination (single best — no top-N/interp); that's the compare route
      // view's blue line.
      const { height, mask, transfer } = buildComputeGrid();
      wB.postMessage(
        {
          ...baseMsg,
          height, mask, networkMask: null,
          wantTopN: false,
          wantNetworkInterp: false,
          maximizeLength: 0,
        },
        transfer,
      );
    };
    const wA = spawnWorker((m) => {
      if (m.kind === "progress") reportProgress(parallelOk ? m.progress : m.progress * 0.5);
      else if (m.kind === "done") {
        primary = m;
        if (!parallelOk) {
          // Release wA's full-grid buffers before wB allocates its own —
          // otherwise the two ~3.5 GB workers are resident together anyway
          // and the memory-halving below doesn't hold (computeDone's later
          // terminate loop is a no-op on an already-removed worker, so this
          // is safe to do here).
          wA.terminate();
          state.workers = state.workers.filter((w) => w !== wA);
          startSecondary({ progressBase: 0.5, progressScale: 0.5 });
        }
        maybeFinish();
      }
      else if (m.kind === "error") computeFailed(m.message);
      else if (m.kind === "warning") {
        console.warn("[worker]", m.message);
        status.innerHTML = `<span style="color:#ffb86b">${escapeHtml(workerWarningText(m))}</span>`;
      }
    });
    {
      const { height, mask, networkMask, transfer } = demPayload();
      wA.postMessage({ ...baseMsg, height, mask, networkMask }, transfer);
    }
    if (parallelOk) startSecondary();
  };

  const compareOn = constrainNet && !!document.getElementById("vec-compare")?.checked;
  // Graph mode is inherently network-constrained, so "Compare with unconstrained"
  // applies there too (independent of the now-locked-on raster constrain toggle):
  // graph mode runs a full-DEM unconstrained RASTER scenario alongside the graph
  // compute and exposes the difference through the displayed-scenario picker.
  const graphCompareOn = graphModeActive() && !!document.getElementById("vec-compare")?.checked;

  // Compute source: Browser (in-page pool) / Localhost (native Rust) / Cloud
  // (local orchestrator → pre-baked VM). backendOn = "anything but browser":
  // the density/single dispatch is engine-agnostic and just gets the right
  // base URL (the orchestrator mirrors the backend's /density,/single bytes).
  const cloudMode = computeMode() === "cloud";
  const backendOn = computeMode() !== "browser";
  const backendUrl = effectiveBackendUrl();
  // Will THIS run actually use the native backend? It only does raster density
  // and backend-eligible single-source (from/to/round); top-N, the destination
  // path, "maximize", graph mode, AND a non-density compare (which routes to the
  // browser-only startComparePair) always run in-browser. Used to avoid booting a
  // cloud VM for a run that would compute in-browser anyway.
  // nDirs ≠ 8: served by backend ≥ 0.2.0 (the move-set port). Cloud is
  // OPTIMISTIC here — the VM's version is only known after boot, so we boot
  // and re-check at dispatch (backendServesNDirs), falling back with a clear
  // reason if the binary is older. Localhost knows the version from the idle
  // /health probe, so it gates accurately up front.
  const nDirsOk = nDirs === 8 ||
    (cloudMode ? true : backendServesNDirs());
  const willUseBackend = backendOn && !graphModeActive() && nDirsOk &&
    (wantDensity || (!compareOn && !wantTopN && !maximize && !state.dst));
  // Run-scoped engine override. Normally tracks backendOn, but a failed cloud
  // boot flips it to false so the density path (which reads it inside
  // densityField) finishes in-browser like the single path. Assigned in
  // dispatchCompute(useBackend) before any compute starts.
  let runUseBackend = backendOn;

  // Density + compare: the two scenarios run sequentially (each already
  // saturates the cores), splitting the progress bar. Diffs come from the
  // RAW constrained field (pre-interp); the energy difference is therefore
  // naturally confined to network cells.
  const startDensityCompare = async () => {
    // The accessibility matrix rides on scenario A (the constrained one —
    // the realistic access); B is the counterfactual and skips it.
    const A = await densityField({ useNetwork: true, progressBase: 0, progressScale: 0.5, wantMatrix });
    if (gen !== state.computeGen) return;
    const B = await densityField({ useNetwork: false, progressBase: 0.5, progressScale: 0.5 });
    if (gen !== state.computeGen) return;
    let diffE = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = A.energy[i], b = B.energy[i];
      diffE[i] = (Number.isFinite(a) && Number.isFinite(b)) ? Math.max(0, a - b) : Infinity;
    }
    // Difference is computed from the RAW constrained field (network cells
    // only), then visually filled like the constrained field when the
    // interp option is on.
    if (wantNetworkInterp && constrainNet) {
      diffE = await runInterp(diffE);
      if (gen !== state.computeGen) return;
    }
    finishDensityOutputs(A.energy, A.passes, {
      energyAlt: { unconstrained: B.energy, difference: diffE },
      passesAlt: { unconstrained: B.passes },
    }, A);
  };

  // Full-DEM UNCONSTRAINED raster energy field for graph-mode compare (no network
  // mask). Density → browser pool; single-source → one worker (energy only, no
  // path/top-N). Resolves a Float32Array (Infinity where unreachable), or null on
  // cancel/error. Runs in-browser (graph mode never uses the native backend).
  // Returns { energy, passes } — passes is the unconstrained TERRAIN density (a
  // raster), present only for the density partner (the from/to partner is
  // energy-only). Used for the graph-mode difference's 3C.b terrain channel.
  const computeUnconstrainedEnergy = () => {
    if (wantDensity) return computeDensityField({ useNetwork: false }).then((r) => ({ energy: r.energy, passes: r.passes || null, path: null, pathEnergy: null, pathLengthM: null }));
    return new Promise((resolve) => {
      const w = spawnWorker((m) => {
        if (m.kind === "done") resolve({ energy: m.energy, passes: m.passes || null, path: m.path || null, pathEnergy: m.pathEnergy ?? null, pathLengthM: m.pathLengthM ?? null });
        else if (m.kind === "error") { computeFailed(m.message); resolve(null); }
      });
      const { height, mask, transfer } = buildComputeGrid();
      // Same mode/cost/budget as the graph run; no network, no top-N/interp. We
      // KEEP baseMsg's goalR/goalC so the partner ALSO traces the best TERRAIN
      // route to the destination → the compare route view's blue line.
      w.postMessage(
        { ...baseMsg, height, mask, networkMask: null, wantTopN: false, maximizeLength: 0, wantNetworkInterp: false },
        transfer,
      );
    });
  };

  // "Follow the vectors": route on the network graph instead of the raster.
  // Lazily (re)builds the cached graph in a worker, then runs the chosen mode
  // on it and renders the colored-vector overlay. Same gen/cancel semantics.
  const startGraphCompute = () => {
    const token = computeNetworkGraphToken();
    // IDW-fill a rasterised graph field (energy or difference) off-network, using
    // the field's own finite cells as seeds (the graph IS the network). Resolves
    // with the filled field; transfers the input buffer (caller must not reuse it).
    const graphInterp = (field) => new Promise((resolve) => {
      const seedMask = new Uint8Array(field.length);
      for (let i = 0; i < field.length; i++) seedMask[i] = Number.isFinite(field[i]) ? 1 : 0;
      const mask = buildComputeGrid({ maskOnly: true }).mask; // don't fill across water
      const w = spawnWorker((m) => {
        // Terminate here rather than waiting for the next compute — this
        // worker's job is done either way, and leaving it resident pins its
        // full-grid buffers (~15 B/cell) until the next cancelActiveCompute()/
        // DEM change (same rationale as computeDone's terminate loop).
        const done = () => {
          w.terminate();
          const ix = state.workers.indexOf(w);
          if (ix >= 0) state.workers.splice(ix, 1);
        };
        if (m.kind === "interp-done") { done(); if (gen !== state.computeGen) return; resolve(m.energy); }
        // On error, `field` is already DETACHED (transferred to the worker), so it
        // can't be returned — resolve null and let the caller keep the prior field.
        else if (m.kind === "error") { done(); console.warn("[graph interp]", m.message); resolve(null); }
      });
      w.postMessage(
        { kind: "interp", energy: field, networkMask: seedMask, mask, H: state.dem.H, W: state.dem.W, dx: state.dem.dxM, dy: state.dem.dyM, interpMaxDistance, interpSmoothing },
        [field.buffer, seedMask.buffer, mask.buffer],
      );
    });
    const finishGraph = async (graph, result) => {
      if (gen !== state.computeGen) return;
      // Rasterise the graph energy onto the grid (network cells only) BEFORE
      // terminating workers — graph-mode compare spawns an unconstrained partner.
      const eGrid = rasterizeGraphEnergy(graph, result);

      // Graph-mode compare: run a full-DEM unconstrained RASTER scenario and diff
      // it against the graph energy (network cells), mirroring raster compare. The
      // diff is the energy COST of being restricted to the network (clamped ≥ 0).
      let energyAlt = null;
      let passesAlt = null;
      let terrainPath = null, terrainPathEnergy = null, terrainPathLengthM = null;
      if (graphCompareOn && eGrid) {
        status.textContent = t("status.computing");
        const unconR = await computeUnconstrainedEnergy();
        if (gen !== state.computeGen || !unconR || !unconR.energy) return;
        const uncon = unconR.energy;
        const diff = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          const a = eGrid[i], b = uncon[i];
          diff[i] = (Number.isFinite(a) && Number.isFinite(b)) ? Math.max(0, a - b) : Infinity;
        }
        energyAlt = { unconstrained: uncon, difference: diff };
        // Terrain (free-movement) passes as a RASTER → the difference view's 3C.b
        // channel. Present for density compares; null for from/to (energy-only partner).
        if (unconR.passes) passesAlt = { unconstrained: unconR.passes };
        // The unconstrained best TERRAIN route (raster) for the compare route view's
        // blue line — only present when a destination is set (from/to/round).
        if (unconR.path && unconR.path.length) {
          terrainPath = unconR.path;
          terrainPathEnergy = unconR.pathEnergy ?? null;
          terrainPathLengthM = unconR.pathLengthM ?? null;
        }
      }

      // Finalise the run now (the partner, if any, is done).
      for (const w of state.workers) w.terminate();
      state.workers = [];
      progress.classList.remove("active");
      updateRunButtonState();
      state.computeStartedAt = 0;
      setGroupOpen("result-group", true); // graph compute done → reveal results (3)
      state.lastGraphResult = { graph, result, energyAlt, passesAlt, pathAlt: terrainPath, pathAltEnergy: terrainPathEnergy, pathAltLengthM: terrainPathLengthM };
      state.graphEnergyRaster = null;
      renderGraphOverlay();   // passes corridors show immediately
      // Learn the graph engine's real per-edge cost (corrGraph). The graph's
      // actual node/edge counts also sharpen the next estimate. Skip the
      // correction on compare runs — their elapsed includes the partner scenario.
      if (state.networkGraph) { state.networkGraph.nNodes = graph.nNodes; state.networkGraph.nEdges = graph.nEdges; }
      if (!energyAlt) { updateEstimateCorrection(result.elapsedMs, 0); estimateRunTime(); }
      // Same retry as the grid computeDone: the calibration probe is skipped
      // while a compute runs — if this DEM still has no calibration (e.g. the
      // probe errored at DEM load), run it now that the cores are free. Graph
      // users never hit the grid completion path, so without this the
      // pre-flight estimate would stay blank for the rest of the session.
      if (!state.calibration) startCalibrationProbe();
      const routeNote = result.routes ? t("status.graph_route_note", result.routes.length) : "";
      const doneMsg = t("status.graph_done", result.elapsedMs.toFixed(0), graph.nNodes, graph.nEdges, routeNote);
      // Energy field: rasterise the graph energy onto the grid, then (when the
      // interp option is on) IDW-fill off-network — the smooth field grid shows.
      if (eGrid && wantNetworkInterp) {
        status.textContent = t("status.interpolating_energy");
        const interpStart = performance.now();
        // null = interp failed (e.g. OOM); leave graphEnergyRaster null (no energy
        // overlay, passes corridors still show) — the pre-refactor behaviour.
        const filled = await graphInterp(eGrid);
        if (gen !== state.computeGen) return;
        if (filled) state.graphEnergyRaster = filled;
        // Fill the difference field the same way so the "difference" scenario reads
        // as a smooth field (it's analysed on network cells, filled for display).
        // On interp failure difference becomes null → the picker falls back to the
        // constrained field (renderGraphOverlay) instead of a blank overlay.
        if (energyAlt) {
          energyAlt.difference = await graphInterp(energyAlt.difference);
          if (gen !== state.computeGen) return;
        }
        renderGraphOverlay();
        status.textContent = doneMsg;
        scheduleStatusClear(doneMsg);
        // Graph interp is single-worker — learn its rate (corrInterp).
        if (!energyAlt) { updateEstimateCorrection(0, performance.now() - interpStart); estimateRunTime(); }
      } else {
        if (eGrid) state.graphEnergyRaster = eGrid;
        renderGraphOverlay();
        status.textContent = doneMsg;
        scheduleStatusClear(doneMsg);
      }
    };
    const runOnGraph = (graph) => {
      if (gen !== state.computeGen) return;
      const params = {
        mode, cost, eMax, eMaxMode,
        srcRC: state.src || null,
        dstRC: state.dst || null,
        wantPath: !!state.dst,
        wantTopN, nRoutes, penalty,
        maximize, maximizeLength,
        densityMode: mode,
      };
      if (wantDensity) {
        params.mode = "density";
        params.refRCs = state.refPoints.slice();
      }
      const w = spawnWorker((m) => {
        if (m.kind === "progress") reportProgress(m.progress);
        else if (m.kind === "graph-result") finishGraph(graph, m.result);
        else if (m.kind === "error") computeFailed(m.message);
      });
      // No transfer list → the cached graph is structured-cloned, not detached.
      w.postMessage({ kind: "graphRun", graph, params, gen });
    };
    if (state.networkGraph && state.networkGraphToken === token) { runOnGraph(state.networkGraph); return; }
    status.textContent = t("status.building_graph");
    const wb = spawnWorker((m) => {
      if (m.kind === "graph-built") {
        if (gen !== state.computeGen) return;
        state.networkGraph = m.graph;
        state.networkGraphToken = token;
        runOnGraph(m.graph);
      } else if (m.kind === "error") computeFailed(m.message);
    });
    // Compose the impassable mask + bridge corridors so graph node elevations
    // get the bridge profile and water nodes are marked invalid.
    const grid = buildComputeGrid();
    const dem = {
      height: grid.height, mask: grid.mask,
      H: state.dem.H, W: state.dem.W, dxM: state.dem.dxM, dyM: state.dem.dyM,
    };
    // Node-snap tolerance: the engine takes CELLS, but a fixed 0.5 scales with
    // resolution (45 m on COP90 — coarse DEMs collapse distinct junctions).
    // Cap the physical size at 15 m; on FABDEM 30 m this stays exactly 0.5.
    const cellMetres = Math.min(state.dem.dxM, state.dem.dyM);
    const snapTolCells = Math.min(0.5, 15 / cellMetres);
    wb.postMessage(
      { kind: "graphBuild", lines: networkLinesToCellLines(), dem, opts: { junctionMode: graphJunctionMode(), snapTolCells, stepCells: 1, lineMeta: state.networkLinesMeta }, gen },
      [dem.height.buffer, dem.mask.buffer],
    );
  };

  // The actual engine dispatch. `useBackend` is normally `backendOn`, but a
  // failed cloud boot calls it with `false` so the run finishes in-browser.
  // Mirror it into runUseBackend so the density path (densityField) agrees.
  const dispatchCompute = (useBackend) => {
    runUseBackend = useBackend;
    if (graphModeActive() && state.networkLines && state.networkLines.length) {
      startGraphCompute();
    } else if (wantDensity && compareOn) {
      startDensityCompare();
    } else if (wantDensity) {
      (async () => {
        const r = await densityField({ useNetwork: constrainNet, wantMatrix });
        if (gen !== state.computeGen) return;
        finishDensityOutputs(r.energy, r.passes, null, r);
      })();
    } else if (compareOn) {
      startComparePair();
    } else if (useBackend && !wantTopN && !maximize && !state.dst &&
               (nDirs === 8 || cloudMode || backendServesNDirs())) {
      // Single-source energy field on the native backend (energy + optional
      // passes). Top-N / maximize / a destination path need the browser (the
      // backend produces no routes); any backend failure falls back too.
      // nDirs ≠ 8: same optimistic-cloud + version-check pattern as density.
      (async () => {
        const t0 = performance.now();
        let r;
        try {
          if (nDirs !== 8 && !backendServesNDirs()) {
            throw new Error(t("cloud.backend_old_ndirs",
                              (state.backendCores && state.backendCores.version) || "?", nDirs));
          }
          r = await startSingleBackend(computeDataUrl());
        } catch (err) {
          if (gen !== state.computeGen) return;
          if (cloudMode && cloudNoFallback()) {
            computeFailed(t("cloud.failed_hard", err?.message || String(err)));
            return;
          }
          console.warn("[backend] falling back to in-browser workers:", err);
          status.textContent = t(cloudMode ? "cloud.preempted" : "status.backend_fallback",
                                 err?.message || String(err));
          if (state.lastRun) state.lastRun.backend = false;
          startSingleWorker();
          return;
        }
        if (gen !== state.computeGen || !r) return;
        const computeMs = performance.now() - t0;
        // The backend returns the raw network-constrained field; the IDW fill is
        // a separate browser phase (the worker did it inline for the JS path).
        let energy = r.energy, interpMs = 0;
        if (wantNetworkInterp && constrainNet) {
          const ti = performance.now();
          energy = await runInterp(energy);
          if (gen !== state.computeGen) return;
          interpMs = performance.now() - ti;
        }
        computeDone({
          energy, passes: r.passes,
          path: null, pathEnergy: null, pathLengthM: null, routes: null,
          elapsedMs: performance.now() - t0, computeMs, interpMs,
        });
      })();
    } else {
      startSingleWorker();
    }
  };

  // The browser/localhost paths dispatch straight away. Cloud first boots the
  // VM through the orchestrator (idempotent), runs the client-side keepalive
  // (in-flight flag only — no orchestrator-side lease) while the compute runs,
  // and stops the VM in computeDone. On a missing
  // orchestrator URL, or an orchestrator/boot failure, it falls back to the
  // in-browser pool for this run (densityField()/single's own try/catch then
  // re-tags lastRun.backend=false; here we force useBackend=false up front).
  if (!cloudMode) {
    state.cloud.mode = "browser"; // a prior cloud run must not stop a VM in this run's computeDone
    dispatchCompute(backendOn);
  } else if (!willUseBackend) {
    // Cloud selected, but THIS run (top-N / destination / maximize / graph)
    // computes in-browser regardless — don't boot a billable VM we won't touch
    // (it would only delay the run ~1 min and bill for nothing). The orchestrator
    // URL is irrelevant for such a run, so don't require it either.
    state.cloud.mode = "browser";
    dispatchCompute(false);
  } else if (!backendUrl) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("cloud.need_orch_url")}</span>`;
    cancelActiveCompute();
    runBtn.disabled = false;
    progress.classList.remove("active");
  } else if (!cloudToken()) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("cloud.need_password")}</span>`;
    cancelActiveCompute();
    runBtn.disabled = false;
    progress.classList.remove("active");
  } else {
    state.cloud.mode = "cloud";
    state.cloud.orchestratorUrl = backendUrl;
    (async () => {
      let ready = false;
      try {
        ready = await ensureCloudVm(backendUrl, () => gen !== state.computeGen);
      } catch (err) {
        if (gen !== state.computeGen) return;
        console.warn("[cloud] VM unavailable, falling back to browser:", err);
        const reason = err && err.reason;
        const bootFailed = reason === "boot_failed";
        // A boot_failed VM may have actually started before going unhealthy —
        // best-effort stop it so it doesn't linger (the in-VM watchdog backstops).
        if (bootFailed) stopCloudVm(backendUrl);
        // "Falhar em vez de cair pro navegador": abort loudly, no browser run.
        if (cloudNoFallback()) {
          computeFailed(t("cloud.failed_hard", reason || err?.message || String(err)));
          return;
        }
        status.textContent = t(reason === "auth_failed" ? "cloud.auth_failed"
                              : bootFailed ? "cloud.boot_failed"
                              : "cloud.orch_unreachable");
        if (state.lastRun) state.lastRun.backend = false;
        state.cloud.mode = "browser"; // computeDone must not try to stop a VM that never started
        dispatchCompute(false);
        return;
      }
      if (gen !== state.computeGen || !ready) return;
      startCloudKeepalive(backendUrl);
      dispatchCompute(true);
    })();
  }
});

// ------- Render -------
function renderResult({ energy, passes, path, pathEnergy, pathLengthM, routes, elapsedMs, energyAlt, passesAlt, pathAlt, pathAltEnergy, pathAltLengthM, runMode, matrix, matrixOutdated, kpi, stringPulled }) {
  // A grid result supersedes any graph-mode overlay.
  removeGraphLayers();
  state.lastGraphResult = null;
  state.graphEnergyRaster = null;
  // Cache for live re-render on colormap / view / range changes.
  state.lastResult = {
    energy, passes, path, pathEnergy, pathLengthM, routes, elapsedMs,
    energyAlt: energyAlt || null,
    passesAlt: passesAlt || null,
    // Compare runs also carry the unconstrained best TERRAIN route (blue), shown
    // alongside / instead of the network route (orange) per the scenario picker.
    pathAlt: pathAlt || null,
    pathAltEnergy: pathAltEnergy ?? null,
    pathAltLengthM: pathAltLengthM ?? null,
  };

  // The displayed-scenario selector only makes sense after a compare run.
  const srcRow = document.getElementById("energy-source-row");
  if (srcRow) srcRow.style.display = (energyAlt || passesAlt) ? "" : "none";
  if (!energyAlt && !passesAlt) {
    const sel = document.getElementById("energy-source");
    if (sel) sel.value = "constrained";
  }

  // Auto bounds (state.lastAutoMin/Max and lastPassesAutoMin/Max) are
  // populated by renderFieldToDataURL during rerenderCachedResult below
  // — both layers use percentile clipping by default and the resolved
  // bounds come back from the renderer.

  // Show/hide the passes layer controls based on whether passes was computed
  const passesRow = document.getElementById("passes-row");
  if (passesRow) passesRow.style.display = passes ? "" : "none";

  rerenderCachedResult();

  const meta = [];
  // rerenderCachedResult populates state.lastAutoMax /
  // state.lastPassesAutoMax with the renderer's resolved upper bounds
  // (after percentile clipping etc.). Earlier code referenced bare
  // `autoMax` / `passesMax` here, which were never declared — left over
  // from a refactor that broke the metadata line silently until the
  // length-DP path actually triggered the renderer in a state that
  // exposed the unhandled exception.
  const eHi = state.lastAutoMax;
  if (Number.isFinite(eHi)) {
    meta.push(t("stats.max_e", eHi.toExponential(2)));
  }
  meta.push(t("stats.time", elapsedMs.toFixed(0)));
  if (passes) {
    const pHi = state.lastPassesAutoMax;
    if (Number.isFinite(pHi)) {
      meta.push(t("stats.max_passes", pHi.toExponential(2)));
    }
  }
  if (routes && routes.length) {
    meta.push(t("stats.routes_count", routes.length));
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      meta.push(
        `  ${i + 1}. E=<span class="v">${r.energy.toExponential(2)}</span>, ` +
        `L=<span class="v">${(r.length / 1000).toFixed(2)} km</span>` +
        (r.shared > 0 ? t("stats.shared", r.shared) : "")
      );
    }
    // Round mode: the round FIELD is fwd+bwd, but the A* alternatives are
    // still scored seed→goal only (by design) — say so, or the route
    // energies look inconsistent with the field. Prefer the run's OWN mode
    // (snapshotted by the caller) over the live #mode select, which the user
    // may have changed while this compute was still in flight — the DOM
    // fallback only matters for the bundle-restore path (applyMetadataToUI
    // sets the select from the bundle's params before rendering).
    if (((runMode ?? document.getElementById("mode")?.value) || "from") === "round") {
      meta.push(t("route.round_note"));
    }
  } else if (pathEnergy != null) {
    meta.push(t("stats.path_e", pathEnergy.toExponential(3)));
    meta.push(t("stats.length", (pathLengthM / 1000).toFixed(2)));
  }
  // Compare run: the unconstrained best terrain route, alongside the network one.
  if (pathAlt && pathAlt.length && pathAltEnergy != null) {
    meta.push(t("route.terrain_meta", pathAltEnergy.toExponential(3), (pathAltLengthM / 1000).toFixed(2)));
  }
  if (stringPulled) meta.push(t("stats.pulled"));
  resultMeta.innerHTML = meta.join("<br/>");
  resultMeta.removeAttribute("data-i18n"); // live stats — don't let a lang toggle reset to "—"

  // Accessibility KPIs: install (or clear) the pairwise-matrix cache OUTSIDE
  // state.lastResult — style re-renders must never touch it.
  installKpiResult(matrix || null, kpi || null, !!matrixOutdated);
}

// ---- Accessibility KPIs (300 kJ initiative) --------------------------------
// state.kpi caches the pairwise matrix from the last density run in OUTBOUND
// row form: mat[i*K + j] = energy of ref i's trip to ref j under the run's
// mode ("from": i→j; raw "to" rows hold e(j→i) and are transposed once at
// install; "round": the masked round-trip total). count_i(E) =
// |{j : mat[i*K+j] ≤ E}| — self included, a ref always reaches its own share.
// With census sampling every ref proxies popM/K people, so
//   KPI 1 = % of refs with (popM/K)·count_i(E₁) ≥ K_people   (needs M)
//   KPI 2 = % of refs with count_i(E₂)/K ≥ J/100             (M-free)
// and "% of refs" reads as "% of population" because the sampling itself is
// population-weighted. A threshold is EXACT iff the run had no budget or the
// threshold ≤ eMax; beyond that the matrix is budget-truncated and the KPIs
// are lower bounds (the block warns). Threshold edits re-evaluate the cached
// matrix only — like the style knobs, they must never trigger a recompute.

function installKpiResult(matrix, snap, outdated) {
  if (!matrix || !snap) {
    if (outdated && snap) {
      // The native backend predates the matrix: keep the block visible with
      // the hint instead of silently hiding the feature.
      state.kpi = {
        unavailable: true, mat: null, K: snap.refs.length, refs: snap.refs,
        popM: snap.popM, eMax: snap.eMax, eMaxMode: snap.eMaxMode, mode: snap.mode,
        refsMatch: false,
      };
      renderKpiBlock();
      return;
    }
    kpiInvalidate();
    return;
  }
  const K = snap.refs.length;
  let mat = matrix;
  if (snap.mode === "to") {
    mat = new Float32Array(K * K);
    for (let i = 0; i < K; i++)
      for (let j = 0; j < K; j++) mat[i * K + j] = matrix[j * K + i];
  }
  // Marker recoloring is only valid while the on-map refs still ARE the
  // run's refs — a mid-run ref edit already invalidated once, but the
  // arriving result re-installs against its own snapshot.
  const refsMatch = state.refPoints.length === K &&
    state.refPoints.every(([r, c], i) => snap.refs[i].r === r && snap.refs[i].c === c);
  state.kpi = {
    mat, K, refs: snap.refs, popM: snap.popM,
    eMax: snap.eMax, eMaxMode: snap.eMaxMode, mode: snap.mode, refsMatch,
  };
  // Prefill M from the census proxy; editable (non-census sampling needs a
  // hand-entered M for KPI 1 — KPI 2 works without one).
  const popInput = document.getElementById("kpi-pop");
  if (popInput) popInput.value = snap.popM != null ? String(Math.round(snap.popM)) : "";
  const popLabel = document.getElementById("kpi-pop-label");
  if (popLabel) {
    popLabel.setAttribute("data-i18n", snap.popM != null ? "kpi.pop_census" : "kpi.pop");
    popLabel.textContent = t(snap.popM != null ? "kpi.pop_census" : "kpi.pop");
  }
  renderKpiBlock();
}

// count_i(E) over the outbound matrix — one O(K²) pass per threshold.
function kpiCounts(mat, K, E) {
  const counts = new Int32Array(K);
  for (let i = 0; i < K; i++) {
    let n = 0;
    const row = i * K;
    for (let j = 0; j < K; j++) if (mat[row + j] <= E) n++;
    counts[i] = n;
  }
  return counts;
}

// Current KPI inputs (initiative defaults live in index.html), resolved M
// (census prefill or hand-entered), and both per-ref count vectors. Shared
// by the renderer and the CSV exports so they can never disagree.
function kpiEval() {
  const kpi = state.kpi;
  if (!kpi || kpi.unavailable) return null;
  const num = (id, dflt) => {
    const v = parseFloat(document.getElementById(id)?.value);
    return Number.isFinite(v) && v >= 0 ? v : dflt;
  };
  const eK = num("kpi-ek", 200);
  const kPeople = num("kpi-k", 1_000_000);
  const eJ = num("kpi-ej", 600);
  const jPct = Math.min(100, num("kpi-j", 80));
  const popRaw = parseFloat(document.getElementById("kpi-pop")?.value);
  const popM = Number.isFinite(popRaw) && popRaw > 0 ? popRaw : null;
  // Grid-bias correction (research note §10): inflate the thresholds by c —
  // equivalent to deflating the 8-grid's overestimated energies by a shared
  // constant. 1 = off (the conservative-floor default). Counting only; the
  // displayed threshold values stay what the user typed.
  const corrRaw = parseFloat(document.getElementById("kpi-corr")?.value);
  const corr = Number.isFinite(corrRaw) ? Math.min(1.5, Math.max(1, corrRaw)) : 1;
  const { mat, K } = kpi;
  const c1 = kpiCounts(mat, K, eK * corr);
  const c2 = kpiCounts(mat, K, eJ * corr);
  let pass1 = 0, pass2 = 0;
  const perRef = popM != null ? popM / K : 0;
  for (let i = 0; i < K; i++) {
    if (popM != null && perRef * c1[i] >= kPeople) pass1++;
    if (c2[i] / K >= jPct / 100 - 1e-12) pass2++;
  }
  return { eK, kPeople, eJ, jPct, popM, corr, c1, c2, pass1, pass2, K };
}

function renderKpiBlock() {
  const group = document.getElementById("kpi-group");
  if (!group) return;
  const kpi = state.kpi;
  if (!kpi) { group.style.display = "none"; return; }
  group.style.display = "";
  const out1 = document.getElementById("kpi-out1");
  const out2 = document.getElementById("kpi-out2");
  const metaEl = document.getElementById("kpi-meta");
  const warnEl = document.getElementById("kpi-warn");
  if (kpi.unavailable) {
    if (out1) out1.textContent = "—";
    if (out2) out2.textContent = "—";
    if (metaEl) metaEl.textContent = "";
    if (warnEl) { warnEl.textContent = t("kpi.backend_no_matrix"); warnEl.style.display = ""; }
    return;
  }
  const ev = kpiEval();
  if (!ev) return;
  const pct = (n) => (100 * n / ev.K).toFixed(1);
  if (out1) {
    out1.innerHTML = ev.popM != null
      ? t("kpi.out1", pct(ev.pass1), Math.round(ev.kPeople).toLocaleString(), ev.eK)
      : t("kpi.out1_need_pop");
  }
  if (out2) out2.innerHTML = t("kpi.out2", pct(ev.pass2), ev.jPct, ev.eJ);
  if (metaEl) {
    const budget = kpi.eMax > 0 ? `${kpi.eMax} kJ${kpi.mode === "round" ? ` (${kpi.eMaxMode})` : ""}` : t("kpi.meta_no_budget");
    let s = t("kpi.meta", kpi.K, kpi.mode, budget);
    if (!kpi.refsMatch) s += `<br/>${t("kpi.refs_changed")}`;
    metaEl.innerHTML = s;
  }
  if (warnEl) {
    const msgs = [];
    if (kpi.eMax > 0 && (ev.eK * ev.corr > kpi.eMax || ev.eJ * ev.corr > kpi.eMax)) {
      msgs.push(t("kpi.warn_budget", kpi.eMax));
    }
    if (ev.corr > 1) msgs.push(t("kpi.corr_note", ev.corr.toFixed(2)));
    warnEl.textContent = msgs.join(" ");
    warnEl.style.display = msgs.length ? "" : "none";
  }
  kpiRecolorMarkers(ev);
}

// Color each ref marker by its accessible population, on a red→yellow→green
// ramp anchored at the KPI-1 threshold (yellow = exactly the target; without
// an M, anchored at the KPI-2 J% target instead). Tooltips carry the number.
function kpiLerpHex(a, b, f) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * f).toString(16).padStart(2, "0")).join("");
}
function kpiRecolorMarkers(ev) {
  const kpi = state.kpi;
  if (!kpi || !kpi.refsMatch) return;
  for (let i = 0; i < kpi.K && i < state.refMarkers.length; i++) {
    const marker = state.refMarkers[i];
    if (!marker) continue;
    // v = attainment vs the anchor target (1 = exactly on target), clamped 2×.
    const v = ev.popM != null
      ? Math.min(2, (ev.popM / kpi.K) * ev.c1[i] / Math.max(1, ev.kPeople))
      : Math.min(2, (ev.c1[i] / kpi.K) / Math.max(1e-9, ev.jPct / 100));
    const color = v <= 1 ? kpiLerpHex("#d73027", "#fee08b", v) : kpiLerpHex("#fee08b", "#1a9850", v - 1);
    marker.setIcon(makeRefIcon(i + 1, color));
    const tip = ev.popM != null
      ? t("kpi.marker_tooltip", i + 1, Math.round((ev.popM / kpi.K) * ev.c1[i]).toLocaleString(), ev.eK)
      : t("kpi.marker_tooltip_frac", i + 1, (100 * ev.c1[i] / kpi.K).toFixed(1), ev.eK);
    marker.unbindTooltip().bindTooltip(tip);
  }
}

// ---- KPI CSV exports (blob-download, mirrors exportRefPoints) --------------
function kpiDownload(name, text, type = "text/csv") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function kpiExportRefsCsv() {
  const kpi = state.kpi;
  const ev = kpiEval();
  if (!kpi || !ev) return;
  const num = (v) => (v == null ? "" : v);
  const lines = [
    `# simujaules accessibility — per-reference table`,
    `# K=${kpi.K} mode=${kpi.mode} eMax_kJ=${kpi.eMax}${kpi.mode === "round" ? ` eMaxMode=${kpi.eMaxMode}` : ""} M=${num(ev.popM)} E1_kJ=${ev.eK} K_people=${ev.kPeople} E2_kJ=${ev.eJ} J_pct=${ev.jPct} grid_corr=${ev.corr}`,
    `index,row,col,lat,lng,count_E1,acc_pop_E1,frac_refs_E1,kpi1_pass,count_E2,frac_refs_E2,kpi2_pass`,
  ];
  const perRef = ev.popM != null ? ev.popM / kpi.K : null;
  for (let i = 0; i < kpi.K; i++) {
    const rf = kpi.refs[i];
    lines.push([
      i + 1, rf.r, rf.c,
      rf.lat != null ? rf.lat.toFixed(6) : "", rf.lng != null ? rf.lng.toFixed(6) : "",
      ev.c1[i],
      perRef != null ? Math.round(perRef * ev.c1[i]) : "",
      (ev.c1[i] / kpi.K).toFixed(4),
      perRef != null ? (perRef * ev.c1[i] >= ev.kPeople ? 1 : 0) : "",
      ev.c2[i],
      (ev.c2[i] / kpi.K).toFixed(4),
      ev.c2[i] / kpi.K >= ev.jPct / 100 - 1e-12 ? 1 : 0,
    ].join(","));
  }
  kpiDownload("simujaules-access-refs.csv", lines.join("\n") + "\n");
}
function kpiExportMatrixCsv() {
  const kpi = state.kpi;
  if (!kpi || kpi.unavailable) return;
  const { mat, K } = kpi;
  const lines = [
    `# simujaules accessibility — outbound pairwise energy (kJ); empty = unreachable within the run budget`,
    "from\\to," + Array.from({ length: K }, (_, j) => j + 1).join(","),
  ];
  const row = new Array(K + 1);
  for (let i = 0; i < K; i++) {
    row[0] = i + 1;
    for (let j = 0; j < K; j++) {
      const v = mat[i * K + j];
      row[j + 1] = Number.isFinite(v) ? v.toFixed(3) : "";
    }
    lines.push(row.join(","));
  }
  kpiDownload("simujaules-access-matrix.csv", lines.join("\n") + "\n");
}

// Threshold edits re-evaluate the cached matrix live — never a recompute.
for (const id of ["kpi-ek", "kpi-k", "kpi-ej", "kpi-j", "kpi-pop", "kpi-corr"]) {
  document.getElementById(id)?.addEventListener("input", () => { if (state.kpi) renderKpiBlock(); });
}
document.getElementById("kpi-export-csv")?.addEventListener("click", kpiExportRefsCsv);
document.getElementById("kpi-export-matrix")?.addEventListener("click", kpiExportMatrixCsv);

// Re-render the cached energy + passes overlays with the currently-selected
// colormap. Called from renderResult (after a compute), from the colormap
// selector, and from any of the per-field range inputs.
function rerenderCachedResult() {
  // Graph-mode results live on their own vector layer — recolor them and skip
  // the raster pipeline entirely (style knobs still apply, no recompute).
  if (state.lastGraphResult && graphModeActive()) { renderGraphOverlay(); return; }
  // Reverted to grid rendering — drop any leftover graph overlay.
  removeGraphLayers();
  const r = state.lastResult;
  if (!r || !state.dem) return;
  const { path, routes } = r;
  const { H, W, originX, originY, dx, dy, isGeographic } = state.dem;

  // After a compare run, the scenario selector switches BOTH layers.
  // Energy: constrained (default) / unconstrained / difference field.
  // Passes: constrained / unconstrained, and in "difference" mode the two
  // scenarios render TOGETHER — constrained in light red, unconstrained in
  // light green, shared scale (no subtraction; overlap blends to yellow).
  // Pure re-render — no recompute.
  const energySel = document.getElementById("energy-source")?.value || "constrained";
  const energy = (r.energyAlt && energySel !== "constrained" && r.energyAlt[energySel])
    ? r.energyAlt[energySel]
    : r.energy;
  const dualPasses = energySel === "difference" && r.passes && r.passesAlt?.unconstrained;
  // Network-constrained if this result carries a compare (energyAlt ⇒ a network
  // was used) OR the network is currently constraining the grid. (energySel alone
  // is "constrained" by default even for a plain terrain compute — the old bug.)
  const networkUsed = !!r.energyAlt || networkConstraintActive();
  applyDensityChannelGroups(energySel, networkUsed, dualPasses);
  const passes = (r.passesAlt && energySel === "unconstrained" && r.passesAlt.unconstrained)
    ? r.passesAlt.unconstrained
    : r.passes;

  // -- Energy layer. In density mode this is the per-cell mean energy
  // across reference points (Infinity where unreachable from every ref);
  // otherwise it's the regular src/dst Dijkstra output. Default range
  // is percentile-clipped at p1/p80 — the long tail of "very far from
  // src" cells dominated the raw min/max stretch and washed everything
  // else into the bottom of the colormap.
  if (energy) {
    const out = renderFieldToDataURL(energy, W, H, {
      usePercentileBounds: true,
      percentiles: [1, 80],
      userMin: readRangeInput("vmin", null),
      userMax: readRangeInput("vmax", null),
      useGreyscale: false,
      treatZeroAsTransparent: false,
    });
    state.energyDataUrl = out.url;
    state.lastAutoMin = out.lo;
    state.lastAutoMax = out.hi;
  } else {
    state.energyDataUrl = null;
  }

  // -- Passes layer (greyscale, mirrors energy's absolute-range UI) --
  // Greyscale so additive blending on top of the colour-mapped energy
  // brightens "highway" cells without imposing its own hue. When blend
  // mode is "normal" the renderer paints with full alpha so dim cells
  // read as solid black instead of transparent.
  if (passes && dualPasses && document.getElementById("passes-blend")?.value === "sum-data") {
    // Soma de DADOS (A+B): os dois cenários somados célula a célula e
    // pintados numa paleta só, em composição normal — escala honesta,
    // independente do basemap (a "soma de cores"/plus-lighter soma as CORES
    // já pintadas contra tudo que está por baixo). Usa os controles do canal
    // A; os overrides B (3C.b) não se aplicam à soma. Mesmas opções de
    // render do ramo de campo único logo abaixo — os dois têm que ler igual.
    const a = r.passes, b2 = r.passesAlt.unconstrained;
    const sum = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) sum[i] = a[i] + b2[i];
    const gamma = parseFloat(document.getElementById("passes-gamma")?.value);
    const win = parseInt(document.getElementById("passes-mean-window")?.value, 10);
    const out = renderFieldToDataURL(sum, W, H, {
      usePercentileBounds: true,
      percentiles: [10, 90],
      maxAboveMin: true,
      densityNormalize: true,
      userMin: readRangeInput("passes-vmin", null),
      userMax: readRangeInput("passes-vmax", null),
      gamma: Number.isFinite(gamma) ? gamma : 1,
      meanWindow: Number.isFinite(win) && win > 1 ? win : 1,
      useGreyscale: true,
      solidAlpha: false,
      treatZeroAsTransparent: true,
    });
    state.passesDataUrl = out.url;
    state.lastPassesAutoMin = out.lo;
    state.lastPassesAutoMax = out.hi;
  } else if (passes && dualPasses) {
    const gamma = parseFloat(document.getElementById("passes-gamma")?.value);
    const win = parseInt(document.getElementById("passes-mean-window")?.value, 10);
    const gammaB = parseFloat(document.getElementById("passes-gamma-b")?.value);
    const winB = parseInt(document.getElementById("passes-mean-window-b")?.value, 10);
    const out = renderDualPassesToDataURL(r.passes, r.passesAlt.unconstrained, W, H, {
      userMin: readRangeInput("passes-vmin", null),
      userMax: readRangeInput("passes-vmax", null),
      gamma: Number.isFinite(gamma) ? gamma : 1,
      meanWindow: Number.isFinite(win) && win > 1 ? win : 1,
      userMinB: readRangeInput("passes-vmin-b", null),
      userMaxB: readRangeInput("passes-vmax-b", null),
      gammaB: Number.isFinite(gammaB) ? gammaB : null,
      meanWindowB: Number.isFinite(winB) ? winB : null,
    });
    state.passesDataUrl = out.url;
    state.lastPassesAutoMin = out.lo;
    state.lastPassesAutoMax = out.hi;
  } else if (passes) {
    const blend = document.getElementById("passes-blend")?.value || "plus-lighter";
    const gamma = parseFloat(document.getElementById("passes-gamma")?.value);
    const win = parseInt(document.getElementById("passes-mean-window")?.value, 10);
    // "energy" blend: corridors take the energy field's colour (same
    // resolved lo/hi as the energy layer, rendered just above) and the
    // passes intensity drives the OPACITY — vmin/vmax/gamma shape the
    // alpha ramp. Falls back to greyscale when no energy field exists.
    const energyColor = blend === "energy" && energy && Number.isFinite(state.lastAutoMin);
    const out = renderFieldToDataURL(passes, W, H, {
      // p10/p90 default; passes counts are heavily long-tailed and a few
      // "highway" cells would otherwise dominate the stretch. maxAboveMin re-takes
      // p90 over only the cells above auto-min (the near-zero tail washed it out).
      usePercentileBounds: true,
      percentiles: [10, 90],
      maxAboveMin: true,
      densityNormalize: true, // counts → density units (matches multi-ref density)
      userMin: readRangeInput("passes-vmin", null),
      userMax: readRangeInput("passes-vmax", null),
      gamma: Number.isFinite(gamma) ? gamma : 1,
      meanWindow: Number.isFinite(win) && win > 1 ? win : 1,
      useGreyscale: !energyColor,
      colorField: energyColor
        ? { field: energy, lo: state.lastAutoMin, hi: state.lastAutoMax }
        : null,
      solidAlpha: blend === "normal",
      treatZeroAsTransparent: true,
    });
    state.passesDataUrl = out.url;
    state.lastPassesAutoMin = out.lo;
    state.lastPassesAutoMax = out.hi;
  } else {
    state.passesDataUrl = null;
  }

  // Apply both overlays to the map (creates / updates Leaflet layers).
  applyEnergyOverlay();
  applyPassesOverlay();
  applyLayerControls(); // visibility/opacity/blend

  // Clear existing route polylines before redrawing
  if (state.pathLine) { state.pathLine.remove(); state.pathLine = null; }
  if (state.routeLines) {
    for (const ln of state.routeLines) ln.remove();
  }
  state.routeLines = [];

  function pathToLatLngs(p) {
    return p.map((idx) => {
      const rr = (idx / W) | 0;
      const cc = idx - rr * W;
      return [originY - (rr + 0.5) * dy, originX + (cc + 0.5) * dx];
    });
  }

  if (r.pathAlt && r.pathAlt.length > 0 && isGeographic) {
    // Compare run: the scenario picker switches the BEST ROUTE the same way it
    // switches the field. Network (constrained) route in orange, unconstrained
    // TERRAIN route in blue, both together in the difference view — matching the
    // density difference colours. Single best per scenario (top-N collapses to
    // the optimum route here).
    const netPath = (path && path.length) ? path
      : (routes && routes.length ? routes[0].path : null);
    const netE = r.pathEnergy ?? (routes && routes.length ? routes[0].energy : null);
    const netL = r.pathLengthM ?? (routes && routes.length ? routes[0].length : null);
    const terrE = r.pathAltEnergy, terrL = r.pathAltLengthM;
    const showNet  = energySel === "constrained" || energySel === "difference";
    const showTerr = energySel === "unconstrained" || energySel === "difference";
    if (showTerr) {
      const ln = L.polyline(pathToLatLngs(r.pathAlt), {
        color: TERR_BLUE_CSS, weight: 4, opacity: 0.95, pane: "routesPane",
      }).addTo(map);
      bindRouteCompare(ln, "terrain", netE, netL, terrE, terrL);
      state.routeLines.push(ln);
    }
    if (showNet && netPath) {
      const ln = L.polyline(pathToLatLngs(netPath), {
        color: NET_ORANGE_CSS, weight: 4, opacity: 0.95, pane: "routesPane",
      }).addTo(map);
      bindRouteCompare(ln, "network", netE, netL, terrE, terrL);
      state.routeLines.push(ln);
    }
  } else if (routes && routes.length > 0 && isGeographic) {
    // Top-N: colour each route by rank using the routes-colormap, with a
    // weight that decays slightly so the optimal route reads strongest.
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      const colour = routeColour(i, routes.length);
      const weight = Math.max(2.5, 5 - i * 0.4);
      const opacity = Math.max(0.55, 0.95 - i * 0.05);
      const ln = L.polyline(pathToLatLngs(r.path), {
        color: colour, weight, opacity, pane: "routesPane",
      }).bindTooltip(t("stats.route_tooltip", i + 1, r.energy.toExponential(2), (r.length / 1000).toFixed(2))).addTo(map);
      state.routeLines.push(ln);
    }
  } else if (path && path.length > 0 && isGeographic) {
    state.pathLine = L.polyline(pathToLatLngs(path), {
      color: "#4cc9f0", weight: 4, opacity: 0.95, pane: "routesPane",
    }).addTo(map);
  }

  // Update the legend's numeric ticks to reflect the current mapping.
  updateLegendTicks();
  // Update placeholders so the user can see what "auto" is currently using.
  syncRangePlaceholders();
  // Whatever style was rendered is now the "clean" snapshot. Any input
  // change after this point will re-mark dirty.
  clearStyleDirty();
}

// Separable 2D box blur. Treats the input as zero-padded outside the grid;
// unsettled cells (value 0 in the passes field) get averaged in, which lets
// the smoothed field bleed slightly past the original settled extent — the
// natural "blur" look the user wants.
function boxBlur2D(field, W, H, win) {
  const N = W * H;
  if (win <= 1) return field;
  const half = (win - 1) >> 1;
  // tmp/out are render-only temporaries (Float32, not Float64): the canvas
  // quantises to 8-bit anyway, so a single f32 rounding per cell is
  // invisible, and it halves this function's transient memory on huge DEMs.
  // The sliding-window accumulators (sum/count) stay scalar f64 — only the
  // per-cell STORE rounds. Never touch state.lastResult.passes itself.
  const tmp = new Float32Array(N);
  // Horizontal pass: sliding-window mean over each row.
  for (let r = 0; r < H; r++) {
    const rowOff = r * W;
    let sum = 0, count = 0;
    for (let c = 0; c <= half && c < W; c++) {
      sum += field[rowOff + c];
      count++;
    }
    tmp[rowOff] = sum / count;
    for (let c = 1; c < W; c++) {
      const addC = c + half;
      const remC = c - half - 1;
      if (addC < W) { sum += field[rowOff + addC]; count++; }
      if (remC >= 0) { sum -= field[rowOff + remC]; count--; }
      tmp[rowOff + c] = sum / count;
    }
  }
  // Vertical pass over tmp.
  const out = new Float32Array(N);
  for (let c = 0; c < W; c++) {
    let sum = 0, count = 0;
    for (let r = 0; r <= half && r < H; r++) {
      sum += tmp[r * W + c];
      count++;
    }
    out[c] = sum / count;
    for (let r = 1; r < H; r++) {
      const addR = r + half;
      const remR = r - half - 1;
      if (addR < H) { sum += tmp[addR * W + c]; count++; }
      if (remR >= 0) { sum -= tmp[remR * W + c]; count--; }
      out[r * W + c] = sum / count;
    }
  }
  return out;
}

// Render a 2D scalar field to a base64 dataURL.
// Range: vmin/vmax in real units. When both blank → auto, from the percentile
// clip (`opts.percentiles`, default [10, 90]; all callers set
// usePercentileBounds:true). Mapping is linear lo→hi.
// Returns { url, lo, hi } so the caller can record the resolved bounds
// for the legend / placeholder display.
// `useGreyscale: true` paints a black→white ramp instead of the active
// colormap — used for the passes layer.
// `meanWindow > 1` applies a separable box-blur prefilter (treats unsettled
// cells as zero, so the smoothed field bleeds slightly outside the original
// settled extent — that's the desired blur look).
// `gamma`: exponent γ such that `t' = t^γ`. γ=1 → identity. γ=2 squares
// the intensity (darkens dim cells). γ=0.5 takes the square root
// (brightens dim cells).
// Passes are subtree-size COUNTS; show them in the SAME density units the
// multi-reference density already uses (÷H·W twice) so passes ALWAYS read as a
// normalized density, never raw counts. A field whose max is already < 1 is an
// existing density and is left untouched (no double-division). The scale is a
// constant, so the percentile-normalized COLOUR is unchanged — only the displayed
// numbers (auto bounds + placeholders) move to density units.
function passesAsDensity(field, W, H) {
  if (!field || !field.length) return field;
  let max = 0;
  for (let i = 0; i < field.length; i++) { if (field[i] > max) max = field[i]; }
  if (max < 1) return field; // already a density (or empty) — counts are integers ≥ 1
  const k = 1 / (W * H * W * H);
  // Render-only temporary: Float32 halves transient memory on huge DEMs
  // (density values ~1e-17·counts are far above the f32 denormal floor, and
  // the canvas quantises to 8-bit anyway). Never touch the cached
  // state.lastResult.passes/passesAlt arrays themselves.
  const out = new Float32Array(field.length);
  for (let i = 0; i < field.length; i++) out[i] = field[i] * k;
  return out;
}

function renderFieldToDataURL(field, W, H, opts) {
  const N = W * H;
  if (opts.densityNormalize) field = passesAsDensity(field, W, H);

  // Optional mean filter. boxBlur returns a fresh Float64Array.
  const work = opts.meanWindow && opts.meanWindow > 1
    ? boxBlur2D(field, W, H, opts.meanWindow)
    : field;

  // Resolve bounds.
  let autoLo = Infinity, autoHi = 0;
  if (opts.usePercentileBounds) {
    const [pLo, pHi] = opts.percentiles || [10, 90];
    // Reservoir-sample valid cells into a fixed-size Float32Array.
    // Pushing every valid value into a regular Array OOMs the tab on
    // 100M+-cell DEMs (multi-GB heap) — the typed-array reservoir
    // gives sub-1% percentile accuracy at 100k samples regardless
    // of N. Same pattern as renderReliefToDataURL.
    const SAMPLE_CAP = 100_000;
    const samples = new Float32Array(SAMPLE_CAP);
    let collected = 0;
    let seen = 0;
    for (let i = 0; i < N; i++) {
      const v = work[i];
      if (!Number.isFinite(v) || (opts.treatZeroAsTransparent && v <= 0)) continue;
      if (collected < SAMPLE_CAP) {
        samples[collected++] = v;
      } else {
        const j = Math.floor(Math.random() * (seen + 1));
        if (j < SAMPLE_CAP) samples[j] = v;
      }
      seen++;
    }
    if (collected > 0) {
      // Float32Array.sort sorts numerically by default; a comparator would
      // box every value to a Number wrapper.
      const sorted = samples.subarray(0, collected).slice().sort();
      // Clamp: p=100 would otherwise index sorted[length] (undefined).
      const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p / 100))];
      autoLo = at(pLo);
      autoHi = at(pHi);
      // Passes density heuristic: the long low tail (near-zero cells) drags the
      // pHi percentile down, washing the field out. Re-take pHi over only the
      // cells STRICTLY above auto-min so the upper bound tracks the actual ridges.
      if (opts.maxAboveMin) {
        let s = 0;
        while (s < sorted.length && sorted[s] <= autoLo) s++;
        const len = sorted.length - s;
        if (len > 0) autoHi = sorted[s + Math.min(len - 1, Math.floor(len * pHi / 100))];
      }
    }
  }
  if (opts.autoMin != null) autoLo = opts.autoMin;
  if (opts.autoMax != null) autoHi = opts.autoMax;

  // Every caller passes usePercentileBounds:true, so bounds come from the
  // percentile clip above and the value→colour mapping is always linear
  // (lo→hi). The old raw-min/max auto path + sqrt-stretch branch had no caller
  // and was removed; pin either bound (userMin/userMax) for manual clamping.
  let lo = opts.userMin != null ? opts.userMin : autoLo;
  let hi = opts.userMax != null ? opts.userMax : autoHi;
  if (!Number.isFinite(lo)) lo = 0;
  if (!Number.isFinite(hi) || hi <= lo) hi = lo + 1;
  const span = hi - lo;
  const gammaExp = Math.max(0.01, opts.gamma ?? 1);

  // Stride-downsample the canvas on huge DEMs so createImageData can't OOM
  // the tab (stride=1 → byte-identical to full-res for DEMs under the cap).
  const { stride, outW, outH } = overlayCanvasDims(W, H);
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(outW, outH);

  // Optional second field driving the COLOUR while the primary field
  // drives the ALPHA ("energy color" passes blend): hue from
  // colormap((colorField - lo) / span) with the caller-supplied bounds
  // (the energy layer's resolved lo/hi, so corridors match its legend),
  // opacity from the primary t (so passes vmin/vmax/gamma shape the
  // alpha ramp). Cells where the colour field is Infinity but the
  // primary is drawn (e.g. over-budget corridor cells in round/total
  // mode) clamp to the top colour — they're beyond the displayed max.
  const cfField = opts.colorField ? opts.colorField.field : null;
  let cfLo = 0, cfSpan = 1;
  if (opts.colorField) {
    cfLo = opts.colorField.lo;
    cfSpan = opts.colorField.hi - opts.colorField.lo;
    if (!Number.isFinite(cfLo)) cfLo = 0;
    if (!Number.isFinite(cfSpan) || cfSpan <= 0) cfSpan = 1;
  }

  // Iterate output pixels; sample the source field at the chosen stride.
  // `i` indexes the full-res field (and colorField), `o` the output canvas.
  for (let or = 0; or < outH; or++) {
    const srcR = or * stride;
    for (let oc = 0; oc < outW; oc++) {
      const i = srcR * W + oc * stride;
      const o = or * outW + oc;
      const v = work[i];
      // v <= 0 matches the percentile sampler's exclusion above (the two
      // predicates used to disagree: sampler v<=0, paint v===0, so negatives
      // were dropped from the bounds yet still painted).
      const unsettled =
        !Number.isFinite(v) || (opts.treatZeroAsTransparent && v <= 0);
      if (unsettled) {
        img.data[4 * o + 3] = 0;
        continue;
      }
      let t = (v - lo) / span;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      // Gamma adjustment: t' = t^γ. γ=1 leaves the mapping unchanged.
      if (gammaExp !== 1) t = Math.pow(t, gammaExp);
      let r2, g2, b2, a2;
      if (cfField) {
        const cv = cfField[i];
        let tc = Number.isFinite(cv) ? (cv - cfLo) / cfSpan : 1;
        if (tc < 0) tc = 0;
        else if (tc > 1) tc = 1;
        [r2, g2, b2] = colormap(tc);
        a2 = Math.round(t * 255);
      } else if (opts.tint && opts.tintOpacityRamp) {
        // Graph-mode difference view only: match buildGraphFieldLayer's vector
        // channel exactly — constant hue, opacity 0.3+0.7*t (NOT rgb*t) — so
        // the raster terrain channel and the orange network vectors read at
        // the same visual intensity for equal traffic. The plain rgb*t ramp
        // below is what raster-mode's difference view (renderDualPassesToDataURL)
        // still relies on and must stay untouched.
        const [tr, tg, tb] = opts.tint;
        r2 = tr; g2 = tg; b2 = tb;
        a2 = Math.round((0.3 + 0.7 * t) * 255);
      } else if (opts.tint) {
        // Solid colour scaled by intensity (the orange/azure difference channels);
        // alpha = intensity so dark cells are transparent and additive blends sum.
        const [tr, tg, tb] = opts.tint;
        r2 = Math.round(tr * t); g2 = Math.round(tg * t); b2 = Math.round(tb * t);
        a2 = Math.round(t * 255);
      } else if (opts.useGreyscale) {
        const g = Math.round(t * 255);
        r2 = g2 = b2 = g;
        // For additive-style blends (plus-lighter, screen, multiply, etc.)
        // alpha=brightness makes black cells contribute nothing while bright
        // cells fully add. For "normal" blend that trick reads wrong (dark
        // cells become transparent and the energy field bleeds through), so
        // we use full alpha and let the slider do the dimming. The flag is
        // set by the renderer based on the active blend mode.
        a2 = opts.solidAlpha ? 255 : g;
      } else {
        [r2, g2, b2] = colormap(t);
        // Fully opaque on the canvas; user-facing dimming comes from the
        // L.imageOverlay opacity slider so that 100% on the slider really
        // means 100% opaque.
        a2 = 255;
      }
      img.data[4 * o + 0] = r2;
      img.data[4 * o + 1] = g2;
      img.data[4 * o + 2] = b2;
      img.data[4 * o + 3] = a2;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL(), lo, hi };
}

// Two-scenario passes render for the "difference" view: constrained passes in
// ORANGE, unconstrained in AZURE BLUE, ADDITIVELY blended on a SHARED scale.
// The bases are additive complements (sum = white), so overlap goes to MAX
// brightness where both scenarios route together, and the alpha adds too so
// coincident corridors pop. The blue–orange axis stays discriminable under
// red–green colour-blindness (unlike the old red/green). No subtraction — the
// user reads where each scenario routes its traffic.
// Per-channel controls: the A (orange/constrained = network) channel uses the
// regular passes inputs; the B (blue/unconstrained = terrain) channel takes
// optional overrides that fall back to A's RESOLVED values when blank — so by
// default both channels share one scale (comparable), and each knob can diverge
// independently. Auto bounds are p10/p90 over BOTH fields' positive cells.
function renderDualPassesToDataURL(constrained, unconstrained, W, H, opts) {
  const N = W * H;
  // Both channels → density units (counts ×1/(H·W)²; existing densities untouched).
  constrained = passesAsDensity(constrained, W, H);
  unconstrained = passesAsDensity(unconstrained, W, H);
  const winA = opts.meanWindow && opts.meanWindow > 1 ? opts.meanWindow : 1;
  const winB = opts.meanWindowB && opts.meanWindowB > 1
    ? opts.meanWindowB
    : (opts.meanWindowB == null ? winA : 1);
  const a = winA > 1 ? boxBlur2D(constrained, W, H, winA) : constrained;
  const b = winB > 1 ? boxBlur2D(unconstrained, W, H, winB) : unconstrained;

  // Shared auto bounds: reservoir-sample positive cells from both fields.
  const SAMPLE_CAP = 100_000;
  const samples = new Float32Array(SAMPLE_CAP);
  let collected = 0, seen = 0;
  for (const f of [a, b]) {
    for (let i = 0; i < N; i++) {
      const v = f[i];
      if (!Number.isFinite(v) || v <= 0) continue;
      if (collected < SAMPLE_CAP) samples[collected++] = v;
      else {
        const j = Math.floor(Math.random() * (seen + 1));
        if (j < SAMPLE_CAP) samples[j] = v;
      }
      seen++;
    }
  }
  let autoLo = 0, autoHi = 1;
  if (collected > 0) {
    const sorted = samples.subarray(0, collected).slice().sort();
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p / 100))];
    autoLo = at(10);
    autoHi = at(90);
  }
  let lo = opts.userMin != null ? opts.userMin : autoLo;
  let hi = opts.userMax != null ? opts.userMax : autoHi;
  if (!Number.isFinite(lo)) lo = 0;
  if (!Number.isFinite(hi) || hi <= lo) hi = lo + 1;
  const span = hi - lo;
  const gammaExp = Math.max(0.01, opts.gamma ?? 1);
  // Green channel: explicit overrides, else inherit red's resolved values.
  let loB = opts.userMinB != null ? opts.userMinB : lo;
  let hiB = opts.userMaxB != null ? opts.userMaxB : hi;
  if (!Number.isFinite(loB)) loB = lo;
  if (!Number.isFinite(hiB) || hiB <= loB) hiB = loB + 1;
  const spanB = hiB - loB;
  const gammaExpB = Math.max(0.01, opts.gammaB ?? gammaExp);

  // Channel bases on the COLOURBLIND-SAFE blue–yellow opponent axis (survives
  // red–green CVD, unlike the old red/green), picked as ADDITIVE COMPLEMENTS so
  // their per-channel sum is exactly white (255,255,255) = maximum brightness
  // where both scenarios route together; each alone is maximally discriminable.
  const RA = 255, GA = 165, BA = 60;   // warm orange — A = constrained (network)
  const RB = 0,   GB = 90,  BB = 195;  // azure blue  — B = unconstrained (terrain)

  // Stride-downsample on huge DEMs (stride=1 → byte-identical under the cap).
  const { stride, outW, outH } = overlayCanvasDims(W, H);
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(outW, outH);
  for (let or = 0; or < outH; or++) {
    const srcR = or * stride;
    for (let oc = 0; oc < outW; oc++) {
      const i = srcR * W + oc * stride;
      const o = or * outW + oc;
      let tA = (a[i] - lo) / span;
      let tB = (b[i] - loB) / spanB;
      // Full clamp on BOTH ends: a value below the channel's min must floor
      // at 0, not go negative — a negative channel would subtract from the
      // additive sum and could erase the other channel entirely.
      if (!Number.isFinite(tA) || a[i] <= 0 || tA < 0) tA = 0;
      else if (tA > 1) tA = 1;
      if (!Number.isFinite(tB) || b[i] <= 0 || tB < 0) tB = 0;
      else if (tB > 1) tB = 1;
      if (tA <= 0 && tB <= 0) { img.data[4 * o + 3] = 0; continue; }
      if (gammaExp !== 1 && tA > 0) tA = Math.pow(tA, gammaExp);
      if (gammaExpB !== 1 && tB > 0) tB = Math.pow(tB, gammaExpB);
      img.data[4 * o + 0] = Math.min(255, Math.round(RA * tA + RB * tB));
      img.data[4 * o + 1] = Math.min(255, Math.round(GA * tA + GB * tB));
      img.data[4 * o + 2] = Math.min(255, Math.round(BA * tA + BB * tB));
      img.data[4 * o + 3] = Math.min(255, Math.round((tA + tB) * 255));
    }
  }
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL(), lo, hi, loB, hiB };
}

// ============================================================================
// DEM relief layer (elevation + slope hillshade)
// ============================================================================
// Visualises the loaded DEM as cmocean.phase-coloured elevation with a
// white-to-black slope multiplied on top. Both layers share one rendered
// PNG (single Leaflet imageOverlay, single visibility/opacity control) so
// flat terrain reads as the pure elevation colour and steep terrain
// darkens — the classic hillshade aesthetic where cliffs and ridges read
// as shadow.
//
// Spec (fixed, no UI knobs for now):
//   elevation range  : p5 → p80 percentile of valid heights
//   slope range      : 0   → p80 percentile of |∇h| (m/m)
//   slope gamma      : 1.2 (out = pow(slope_norm, 1/1.2))
//   slope colour ramp: white → black   (slope=0 → 1.0, slope=p80 → 0.0)
//   composite        : multiply         out_rgb = elev_rgb · slopeFactor
//   colormap         : cmo_phase (cyclic, perceptually uniform)

// Central-difference slope magnitude in m/m. Edge cells use replicated
// boundary; masked neighbours fall back to the cell's own height (so a
// nodata strip at the DEM edge produces zero slope rather than a wild
// fictitious gradient).
function computeSlope(height, mask, H, W, dxM, dyM) {
  const slope = new Float32Array(H * W);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      if (!mask[i]) continue;
      const cw = c > 0     ? c - 1 : c;
      const ce = c < W - 1 ? c + 1 : c;
      const rn = r > 0     ? r - 1 : r;
      const rs = r < H - 1 ? r + 1 : r;
      const wIdx = r  * W + cw;
      const eIdx = r  * W + ce;
      const nIdx = rn * W + c;
      const sIdx = rs * W + c;
      const h0 = height[i];
      const hw = mask[wIdx] ? height[wIdx] : h0;
      const he = mask[eIdx] ? height[eIdx] : h0;
      const hn = mask[nIdx] ? height[nIdx] : h0;
      const hs = mask[sIdx] ? height[sIdx] : h0;
      const spanX = (ce - cw) * dxM;
      const spanY = (rs - rn) * dyM;
      const dhdx = spanX > 0 ? (he - hw) / spanX : 0;
      const dhdy = spanY > 0 ? (hs - hn) / spanY : 0;
      slope[i] = Math.sqrt(dhdx * dhdx + dhdy * dhdy);
    }
  }
  return slope;
}

// Sample size for percentile estimation. 100k samples gives a sub-1 %
// error on p5/p80 of a smooth distribution — well below the visual
// resolution of the colormap. Using regular JS arrays here would balloon
// to multi-gig heaps on a 135 M-cell DEM (the "Sampa Sítio Urbano" case)
// and OOM the tab; typed arrays at fixed size keep this <1 MB regardless.
const RELIEF_PERCENTILE_SAMPLES = 100_000;

// Cap on the canvas backing buffer. Above ~10 M pixels Chrome refuses
// to allocate ImageData, and even when it succeeds the toDataURL cost
// dominates. We downsample by an integer stride and let Leaflet's
// imageOverlay scale the result up to the DEM extent — Leaflet uses
// CSS image-rendering, so the texture maps cleanly across the bounds.
const RELIEF_MAX_CANVAS_PX = 10 * 1024 * 1024;

// Shared canvas cap for the field overlays (energy / passes / impassable),
// mirroring the relief renderer. Above RELIEF_MAX_CANVAS_PX cells we render the
// canvas at an integer-strided lower resolution and let Leaflet's imageOverlay
// scale the texture across the same DEM bounds. Without this, createImageData
// at the full W*H OOMs the tab on huge DEMs (the documented 135 M-cell case
// allocates ~540 MB before toDataURL even runs). Returns stride=1 (byte-
// identical to the old full-res path) for any DEM under the cap.
function overlayCanvasDims(W, H) {
  const N = W * H;
  let stride = 1;
  if (N > RELIEF_MAX_CANVAS_PX) stride = Math.ceil(Math.sqrt(N / RELIEF_MAX_CANVAS_PX));
  return { stride, outW: Math.max(1, Math.floor(W / stride)), outH: Math.max(1, Math.floor(H / stride)) };
}

function renderReliefToDataURL(dem, slope) {
  const { H, W, height, mask } = dem;
  const N = H * W;

  // ---- Reservoir-sample valid (height, slope) pairs for percentiles --
  const eSamples = new Float32Array(RELIEF_PERCENTILE_SAMPLES);
  const sSamples = new Float32Array(RELIEF_PERCENTILE_SAMPLES);
  let collected = 0;
  let seen = 0; // count of valid cells visited
  for (let i = 0; i < N; i++) {
    if (!mask[i]) continue;
    if (collected < RELIEF_PERCENTILE_SAMPLES) {
      eSamples[collected] = height[i];
      sSamples[collected] = slope[i];
      collected++;
    } else {
      // Standard reservoir step: replace position j (uniform in [0, seen])
      // with probability k/seen; here that simplifies to "pick a slot".
      const j = Math.floor(Math.random() * (seen + 1));
      if (j < RELIEF_PERCENTILE_SAMPLES) {
        eSamples[j] = height[i];
        sSamples[j] = slope[i];
      }
    }
    seen++;
  }
  if (collected === 0) return null;

  // Float32Array.sort sorts numerically by default — no comparator needed
  // (and passing one would coerce values to objects, defeating the point).
  const eSorted = eSamples.subarray(0, collected).slice().sort();
  const sSorted = sSamples.subarray(0, collected).slice().sort();
  const elevMin  = percentileFromSorted(eSorted, 5);
  const elevMax  = percentileFromSorted(eSorted, 80);
  const slopeMax = Math.max(1e-9, percentileFromSorted(sSorted, 80));
  const elevSpan = elevMax - elevMin;

  // ---- Decide canvas size — downsample if the DEM is too big -------
  let stride = 1;
  if (N > RELIEF_MAX_CANVAS_PX) {
    stride = Math.ceil(Math.sqrt(N / RELIEF_MAX_CANVAS_PX));
  }
  const outW = Math.max(1, Math.floor(W / stride));
  const outH = Math.max(1, Math.floor(H / stride));

  // cmo_phase is cyclic — values that wrap past 1.0 alias to the same
  // hue as 0.0, which is fine since we clip to [0, 1].
  const phaseMap = COLORMAPS.cmo_phase;
  const phaseN = phaseMap.length - 1;

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(outW, outH);
  const data = imageData.data;

  const invGamma = 1 / 1.2;

  // ---- Render at the (possibly downsampled) output resolution ------
  for (let or = 0; or < outH; or++) {
    const srcR = or * stride;
    for (let oc = 0; oc < outW; oc++) {
      const srcC = oc * stride;
      const srcI = srcR * W + srcC;
      const j = (or * outW + oc) * 4;
      if (!mask[srcI]) {
        data[j + 3] = 0; // transparent over nodata
        continue;
      }

      // -- Elevation lookup
      let er, eg, eb;
      if (elevSpan > 0) {
        const t = Math.max(0, Math.min(1, (height[srcI] - elevMin) / elevSpan));
        const f = t * phaseN;
        const k = Math.floor(f);
        const frac = f - k;
        const a = phaseMap[Math.min(k, phaseN)];
        const b = phaseMap[Math.min(k + 1, phaseN)];
        er = a[0] + (b[0] - a[0]) * frac;
        eg = a[1] + (b[1] - a[1]) * frac;
        eb = a[2] + (b[2] - a[2]) * frac;
      } else {
        // Pathological DEM (all same elevation) — paint mid-colormap.
        const a = phaseMap[Math.floor(phaseN / 2)];
        er = a[0]; eg = a[1]; eb = a[2];
      }

      // -- Slope as gamma-corrected white→black multiplier.
      //    slope=0   → factor 1.0 (multiplying by white leaves elev alone)
      //    slope=p80 → factor 0.0 (multiplying by black collapses to black)
      const sNorm = Math.min(1, slope[srcI] / slopeMax);
      const sGamma = Math.pow(sNorm, invGamma);
      const slopeFactor = 1 - sGamma;
      data[j]     = Math.round(er * slopeFactor);
      data[j + 1] = Math.round(eg * slopeFactor);
      data[j + 2] = Math.round(eb * slopeFactor);
      data[j + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL();
}

function applyDemReliefOverlay() {
  if (state.demReliefOverlay) {
    state.demReliefOverlay.remove();
    state.demReliefOverlay = null;
  }
  if (!state.dem || !state.dem.isGeographic || !state.demReliefDataUrl) return;
  const { H, W, originX, originY, dx, dy } = state.dem;
  // Bounds must match the SAMPLED extent (outW×outH cells at `stride`), not
  // the full DEM: at stride>1 the rendered canvas only covers up to
  // stride-1 fewer rows/cols, so stretching it across the full DEM rectangle
  // shears corridors near the eastern/southern edge. Identical to today
  // when stride=1 or W,H divide evenly.
  const { stride, outW, outH } = overlayCanvasDims(W, H);
  const bounds = [[originY - outH * stride * dy, originX], [originY, originX + outW * stride * dx]];
  state.demReliefOverlay = L.imageOverlay(
    state.demReliefDataUrl,
    bounds,
    { opacity: 0.85, pane: "reliefPane" },
  ).addTo(map);
}

function impassableOverlayOpacity() {
  const v = parseFloat(document.getElementById("imp-opacity")?.value);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
}

// Paint the EFFECTIVE impassable state to a dataURL for verification: blocked
// water red, reopened bridge corridors green. Returns null when nothing to show.
function renderImpassableDataURL() {
  if (!state.dem || !state.impassable) return null;
  const { H, W } = state.dem;
  const imp = state.impassable;
  // Stride-downsample on huge DEMs (stride=1 → identical under the cap). These
  // are SPARSE features, so we SCATTER each blocked/corridor cell into its
  // downsampled output pixel (point-sampling the strided grid would skip most
  // of them and the overlay would look empty).
  const { stride, outW, outH } = overlayCanvasDims(W, H);
  const canvas = document.createElement("canvas");
  canvas.width = outW; canvas.height = outH;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(outW, outH);
  const d = img.data;
  // Clamp both axes: when W/H isn't a multiple of stride, the last
  // W%stride columns (or H%stride rows) would otherwise compute an out-of-
  // range output column/row — WRAPPING to the next row's pixel 0 for the
  // column case (a right-edge blocked cell painting on the left edge one
  // row down) rather than just landing on the last valid pixel.
  const outIdx = (i) => {
    const r = (i / W) | 0, c = i - r * W;
    const or = Math.min(outH - 1, (r / stride) | 0);
    const oc = Math.min(outW - 1, (c / stride) | 0);
    return (or * outW + oc) << 2;
  };
  for (let i = 0; i < imp.length; i++) {
    if (imp[i]) { const o = outIdx(i); d[o] = 220; d[o + 1] = 48; d[o + 2] = 48; d[o + 3] = 255; } // blocked
  }
  const cells = state.corridorCells;
  if (cells) for (let k = 0; k < cells.length; k++) {
    const o = outIdx(cells[k]); d[o] = 40; d[o + 1] = 200; d[o + 2] = 90; d[o + 3] = 255; // corridor
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

// Build the impassable-layer Leaflet imageOverlay from the current mask +
// corridors. Driven by the #imp-show / #imp-opacity controls in group 1c.
function applyImpassableOverlay() {
  if (state.impassableOverlay) { state.impassableOverlay.remove(); state.impassableOverlay = null; }
  const show = !!document.getElementById("imp-show")?.checked;
  if (!show || !state.dem || !state.dem.isGeographic || !state.impassable) return;
  const url = renderImpassableDataURL();
  if (!url) return;
  const { H, W, originX, originY, dx, dy } = state.dem;
  // Bounds must match the SAMPLED extent (see applyDemReliefOverlay) —
  // identical to today when stride=1 or W,H divide evenly.
  const { stride, outW, outH } = overlayCanvasDims(W, H);
  const bounds = [[originY - outH * stride * dy, originX], [originY, originX + outW * stride * dx]];
  state.impassableOverlay = L.imageOverlay(url, bounds, {
    opacity: impassableOverlayOpacity(), pane: "impassablePane",
  }).addTo(map);
}

// Linearly interpolate the p-th percentile (0..100) from a sorted ascending
// array. Returns NaN if the array is empty.
function percentileFromSorted(sorted, p) {
  const n = sorted.length;
  if (!n) return NaN;
  const t = Math.max(0, Math.min(100, p)) / 100;
  const f = t * (n - 1);
  const i0 = Math.floor(f);
  const i1 = Math.min(n - 1, i0 + 1);
  const frac = f - i0;
  return sorted[i0] + (sorted[i1] - sorted[i0]) * frac;
}

// Build the energy-layer Leaflet imageOverlay from the cached dataURL.
function applyEnergyOverlay() {
  if (state.energyOverlay) { state.energyOverlay.remove(); state.energyOverlay = null; }
  if (!state.dem || !state.dem.isGeographic || !state.energyDataUrl) return;
  const { H, W, originX, originY, dx, dy } = state.dem;
  // Bounds must match the SAMPLED extent (see applyDemReliefOverlay) —
  // identical to today when stride=1 or W,H divide evenly.
  const { stride, outW, outH } = overlayCanvasDims(W, H);
  const bounds = [[originY - outH * stride * dy, originX], [originY, originX + outW * stride * dx]];
  state.energyOverlay = L.imageOverlay(state.energyDataUrl, bounds, { opacity: 0.85, pane: "energyPane" }).addTo(map);
}

// Build the passes-layer Leaflet imageOverlay. Its pane (z 404) sits above
// energy (402) AND the drawn vector network (403), so corridors paint over
// the black network lines.
function applyPassesOverlay() {
  if (state.passesOverlay) { state.passesOverlay.remove(); state.passesOverlay = null; }
  if (!state.dem || !state.dem.isGeographic || !state.passesDataUrl) return;
  const { H, W, originX, originY, dx, dy } = state.dem;
  // Bounds must match the SAMPLED extent (see applyDemReliefOverlay) —
  // identical to today when stride=1 or W,H divide evenly.
  const { stride, outW, outH } = overlayCanvasDims(W, H);
  const bounds = [[originY - outH * stride * dy, originX], [originY, originX + outW * stride * dx]];
  state.passesOverlay = L.imageOverlay(state.passesDataUrl, bounds, { opacity: 0.7, pane: "passesPane" }).addTo(map);
}

// Apply the live UI controls (visibility, opacity, blend mode) to whichever
// overlays exist. Cheap — no canvas re-render. Also drives the tilemap
// add/remove cycle (we only fetch tiles when the user makes it visible).
function applyLayerControls() {
  // rmsampa-v2 tile overlay
  const tileVis = document.getElementById("tile-visible")?.checked ?? false;
  const tileOpRaw = parseFloat(document.getElementById("tile-opacity")?.value);
  const tileOp = Number.isFinite(tileOpRaw) ? tileOpRaw : 0.85;
  if (tileVis && !state.tileOverlayActive) {
    state.tileOverlay.addTo(map);
    state.tileOverlayActive = true;
  } else if (!tileVis && state.tileOverlayActive) {
    state.tileOverlay.remove();
    state.tileOverlayActive = false;
  }
  if (state.tileOverlayActive) {
    state.tileOverlay.setOpacity(tileOp);
  }

  if (state.demReliefOverlay) {
    const visible = document.getElementById("relief-visible")?.checked ?? false;
    const opacity = parseFloat(document.getElementById("relief-opacity")?.value);
    const op = Number.isFinite(opacity) ? opacity : 0.85;
    state.demReliefOverlay.setOpacity(visible ? op : 0);
  }
  if (state.energyOverlay) {
    const visible = document.getElementById("energy-visible")?.checked ?? true;
    const opacity = parseFloat(document.getElementById("energy-opacity")?.value);
    const op = Number.isFinite(opacity) ? opacity : 0.85;
    state.energyOverlay.setOpacity(visible ? op : 0);
  }
  if (state.passesOverlay) {
    const visible = document.getElementById("passes-visible")?.checked ?? true;
    const opacity = parseFloat(document.getElementById("passes-opacity")?.value);
    const op = Number.isFinite(opacity) ? opacity : 0.7;
    // Graph-mode difference view: state.graphPassesLayer (network vectors) and
    // state.passesOverlay (terrain raster) share passesPane. The graphPassesLayer
    // block below already drives the PANE opacity from this same slider, so
    // ALSO setting the imageOverlay element's own opacity here would apply the
    // slider twice (op × op), making the raster channel read dimmer than the
    // vector channel at the same value. Pin the element to fully opaque and
    // let the pane be the single control in that case.
    state.passesOverlay.setOpacity(state.graphPassesLayer ? 1 : (visible ? op : 0));
    const blend = document.getElementById("passes-blend")?.value || "normal";
    const el = state.passesOverlay.getElement();
    // "energy" e "sum-data" são modos de RENDER (cor/soma assadas no canvas),
    // não blends de CSS — compõem normal.
    if (el) el.style.mixBlendMode = (blend === "energy" || blend === "sum-data") ? "normal" : blend;
  }
  // Reference-point markers: show/hide the whole set as a layer toggle.
  if (state.refMarkers) {
    const visible = document.getElementById("refs-visible")?.checked ?? true;
    for (const m of state.refMarkers) {
      if (visible && !map.hasLayer(m)) m.addTo(map);
      else if (!visible && map.hasLayer(m)) m.remove();
    }
  }
  // Graph-mode passes is a vector layer on passesPane (energy is the raster
  // overlay above) — drive its pane opacity + blend from the Passes controls.
  if (state.graphPassesLayer) {
    const visible = document.getElementById("passes-visible")?.checked ?? true;
    const opRaw = parseFloat(document.getElementById("passes-opacity")?.value);
    const op = Number.isFinite(opRaw) ? opRaw : 0.7;
    const blend = document.getElementById("passes-blend")?.value || "normal";
    const pp = map.getPane("passesPane");
    if (pp) {
      pp.style.opacity = String(visible ? op : 0);
      // Additive ("plus-lighter" / soma de cores) blend makes the near-black
      // low-pass lines contribute nothing, leaving only the bright corridors.
      // "sum-data" não tem soma de dados possível aqui (canal vetorial) —
      // compõe normal, como o modo "energy".
      pp.style.mixBlendMode = (blend === "energy" || blend === "sum-data") ? "normal" : blend;
    }
  }
  // Reference geometry (GPX overlay): a simple show/hide toggle (no opacity).
  if (state.refTrackLayer) {
    const visible = document.getElementById("refgeom-visible")?.checked ?? true;
    if (visible && !map.hasLayer(state.refTrackLayer)) state.refTrackLayer.addTo(map);
    else if (!visible && map.hasLayer(state.refTrackLayer)) state.refTrackLayer.remove();
  }
}

// ------- Reference geometry (GPX overlay) -------
// "Geometria de referência": a user-uploaded GPX track shown as an overlay layer.
// Hover/click shows its metrics — distance, total energy (the app's asymmetric
// α·dist+β·dh model, with the CURRENT params, recomputed on each open so it tracks
// edits), total ascent and descent. Elevation is the GPX <ele> if present, else
// sampled from the loaded DEM; without either, only distance is shown.
const REFGEOM_COLOR = "#ff2d95";

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371008.8, toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad, dLng = (lng2 - lng1) * toRad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function sampleDemElevation(lat, lng) {
  if (!state.dem || !state.dem.isGeographic) return null;
  const { H, W, height, mask } = state.dem;
  const [rf, cf] = latLngToCellFrac(lat, lng);
  // Corner-based fractional coords: the point lies in cell floor(r), not round(r).
  const r = Math.floor(rf), c = Math.floor(cf);
  if (r < 0 || r >= H || c < 0 || c >= W) return null;
  const idx = r * W + c;
  return mask[idx] ? height[idx] : null;
}

function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error(t("refgeom.parse_error"));
  let pts = [...doc.getElementsByTagName("trkpt")];
  if (!pts.length) pts = [...doc.getElementsByTagName("rtept")];
  if (!pts.length) pts = [...doc.getElementsByTagName("wpt")];
  const latlngs = [], eles = [];
  for (const p of pts) {
    const lat = parseFloat(p.getAttribute("lat")), lng = parseFloat(p.getAttribute("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    latlngs.push([lat, lng]);
    const e = p.getElementsByTagName("ele")[0];
    const ev = e ? parseFloat(e.textContent) : NaN;
    eles.push(Number.isFinite(ev) ? ev : null);
  }
  if (latlngs.length < 2) throw new Error(t("refgeom.too_short"));
  return { latlngs, eles };
}

// Resolve elevation (GPX → DEM → none), then the params-independent per-segment
// {d, dh} + distance/ascent/descent once. Energy is params-dependent → computed
// fresh from the segments on each hover (refEnergyKJ).
function buildRefTrack(latlngs, eles) {
  let elev = null, eleSource = "none";
  if (eles.some((e) => e != null)) { elev = eles.slice(); eleSource = "gpx"; }
  else {
    const demEle = latlngs.map(([la, ln]) => sampleDemElevation(la, ln));
    if (demEle.some((e) => e != null)) { elev = demEle; eleSource = "dem"; }
  }
  if (elev) { // carry-forward fill any gaps so every point has an elevation
    let last = elev.find((e) => e != null) ?? 0;
    for (let i = 0; i < elev.length; i++) { if (elev[i] == null) elev[i] = last; else last = elev[i]; }
  }
  const segs = []; let distM = 0, ascentM = 0, descentM = 0;
  for (let i = 1; i < latlngs.length; i++) {
    const d = haversineM(latlngs[i - 1][0], latlngs[i - 1][1], latlngs[i][0], latlngs[i][1]);
    const dh = elev ? elev[i] - elev[i - 1] : 0;
    segs.push({ d, dh });
    distM += d;
    if (dh > 0) ascentM += dh; else descentM += -dh;
  }
  return { latlngs, segs, distM, ascentM, descentM, eleSource, hasEle: !!elev };
}

// v2 leg energy (kJ) of a route from its {d, dh} segments: the closed form with
// a 2 m elevation deadband (rejects sub-τ jitter in h±) and the ε descent-
// recovery estimator — mirrors bicycling-energy-model compare.mjs
// approximate()+deadband() for the roll/aero/climb walk, and regime_compare.mjs
// epsGeom (journal Entry 18/WI-1) for ε itself. readCost()'s coefficients are
// kJ-based, so the sum is in kJ. Aero is charged only OFF climbs; descent gets
// the drop-weighted ε.
function refEnergyKJ(segs) {
  const c = readCost();
  const tdv = parseFloat(document.getElementById("deadband")?.value);
  const TAU = Math.max(0, Number.isFinite(tdv) ? tdv : 2), n = segs.length;  // τ=0 ⇒ identity (no smoothing)
  // Rebuild the elevation profile from the per-segment Δh and deadband it.
  const h = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) h[i + 1] = h[i] + segs[i].dh;
  let y = h[0];
  const hS = new Float64Array(n + 1); hS[0] = y;
  for (let i = 1; i <= n; i++) {
    if (h[i] > y + TAU) y = h[i] - TAU; else if (h[i] < y - TAU) y = h[i] + TAU;
    hS[i] = y;
  }
  let X = 0, Xnc = 0, hPlus = 0, hMinus = 0;
  for (let i = 0; i < n; i++) {
    const d = segs[i].d; if (!(d > 0)) continue;
    const dh = hS[i + 1] - hS[i];
    X += d;
    if (dh >= 0) { hPlus += dh; if (dh < c.climbThr * d) Xnc += d; }  // aero off climbs
    else { hMinus += -dh; Xnc += d; }                                // descents: full flat aero
  }
  // ε (descent-recovery factor): ports bicycling-energy-model regime_compare.mjs
  // epsGeom EXACTLY (journal Entry 18/WI-1) — every epsGeom call site in that
  // harness resamples the RAW (pre-deadband) profile, never the τ-smoothed one
  // the walk above uses, so this resamples `h`/cumulative distance, not `hS`.
  // Resample into 30 m cells (confirmed load-bearing by Entry 19 — do not
  // change the cell size), accumulate the drop-weighted
  // Σ drop_k·min(1, abRatio/(drop_k/30)) over descending cells, divide by the
  // total drop, THEN subtract epsOffset and clamp₀₁ ONCE on that aggregate
  // (never per-cell — clamping per-cell is what the old lumped-mean-grade s̄ =
  // H₋/X₋ estimator effectively approximated, and it collapses under mixed
  // grades / fine resolution; see Entry 18/19).
  const xCum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) xCum[i + 1] = xCum[i] + segs[i].d;
  const totalM = xCum[n], DX = 30, nc = Math.floor(totalM / DX);
  let eps = 0;
  if (nc >= 2) {
    let j = 0;
    const hAt = (d) => {
      while (j < n - 1 && xCum[j + 1] < d) j++;
      const seg = xCum[j + 1] - xCum[j], f = seg > 1e-9 ? (d - xCum[j]) / seg : 0;
      return h[j] * (1 - f) + h[j + 1] * f;
    };
    const cellH = new Float64Array(nc + 1);
    for (let k = 0; k <= nc; k++) cellH[k] = hAt(k * DX);
    let Hd = 0, epsW = 0;
    for (let k = 0; k < nc; k++) {
      const dh = cellH[k + 1] - cellH[k];
      if (dh < 0) { const drop = -dh; Hd += drop; epsW += drop * Math.min(1, c.abRatio / (drop / DX)); }
    }
    if (Hd >= 1) eps = Math.max(0, Math.min(1, epsW / Hd - c.epsOffset));
  }
  return c.aRoll * X + c.aAero * Xnc + c.beta * (hPlus - eps * hMinus);
}

function refMetricsHtml() {
  const rt = state.refTrack;
  if (!rt) return "";
  const rows = [`<strong>${escapeHtml(t("layer.refgeom"))}</strong>`,
    `${escapeHtml(t("refgeom.distance"))}: ${(rt.distM / 1000).toFixed(2)} km`];
  if (rt.hasEle) {
    rows.push(`${escapeHtml(t("refgeom.energy"))}: ${escapeHtml(formatEnergy(refEnergyKJ(rt.segs)))} kJ`);
    rows.push(`${escapeHtml(t("refgeom.ascent"))}: ${Math.round(rt.ascentM)} m`);
    rows.push(`${escapeHtml(t("refgeom.descent"))}: ${Math.round(rt.descentM)} m`);
  } else {
    rows.push(escapeHtml(t("refgeom.no_elevation")));
  }
  return rows.join("<br>");
}

function renderRefTrack() {
  if (state.refTrackLayer) { state.refTrackLayer.remove(); state.refTrackLayer = null; }
  if (!state.refTrack) return;
  const renderer = L.canvas({ pane: "refgeomPane", tolerance: 8 });
  const line = L.polyline(state.refTrack.latlngs, {
    pane: "refgeomPane", color: REFGEOM_COLOR, weight: 4, opacity: 0.95, interactive: true, renderer });
  // Function content → recomputed each open, so the energy reflects current α/β/η.
  line.bindTooltip(() => refMetricsHtml(), { sticky: true, direction: "top" });
  line.bindPopup(() => refMetricsHtml());
  line.addTo(map);
  state.refTrackLayer = line;
  applyLayerControls();
}

async function loadRefGeometry(file) {
  try {
    status.textContent = t("refgeom.loading");
    const text = await file.text();
    const { latlngs, eles } = parseGpx(text);
    state.refTrack = buildRefTrack(latlngs, eles);
    const vis = document.getElementById("refgeom-visible");
    if (vis) vis.checked = true;
    renderRefTrack();
    map.fitBounds(L.latLngBounds(state.refTrack.latlngs), { padding: [30, 30], maxZoom: 16 });
    status.textContent = t("refgeom.loaded", escapeHtml(file.name), (state.refTrack.distM / 1000).toFixed(2));
  } catch (e) {
    console.error(e);
    status.innerHTML = `<span style="color:#ff6b6b">${escapeHtml(e.message)}</span>`;
  }
}

function updateLegendTicks() {
  // Legend reflects the energy layer's mapping. Default auto = p1/p80
  // linear; user-pinned overrides either bound. Mid is the linear
  // midpoint of the value range (close-enough for any reasonable gamma).
  const lo = document.getElementById("legend-lo");
  const mid = document.getElementById("legend-mid");
  const hi = document.getElementById("legend-hi");
  if (!lo || !mid || !hi) return;
  const userMin = readRangeInput("vmin", null);
  const userMax = readRangeInput("vmax", null);
  const a = userMin != null ? userMin : (state.lastAutoMin ?? 0);
  const b = userMax != null ? userMax : (state.lastAutoMax ?? 1);
  lo.textContent = formatEnergy(a);
  mid.textContent = formatEnergy(0.5 * (a + b));
  hi.textContent = formatEnergy(b);
}

function readRangeInput(id, fallback) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const raw = el.value.trim();
  if (raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function isUserPinned(id) {
  const el = document.getElementById(id);
  if (!el) return false;
  const raw = el.value.trim();
  if (raw === "") return false;
  const n = Number(raw);
  return Number.isFinite(n);
}

function syncRangePlaceholders() {
  const lo = document.getElementById("vmin");
  const hi = document.getElementById("vmax");
  if (lo && state.lastAutoMin != null) lo.placeholder = formatEnergy(state.lastAutoMin);
  if (hi && state.lastAutoMax != null) hi.placeholder = formatEnergy(state.lastAutoMax);
  // Passes absolute inputs — placeholders show the auto bounds.
  const pLo = document.getElementById("passes-vmin");
  const pHi = document.getElementById("passes-vmax");
  if (pLo && state.lastPassesAutoMin != null) pLo.placeholder = formatSci(state.lastPassesAutoMin);
  if (pHi && state.lastPassesAutoMax != null) pHi.placeholder = formatSci(state.lastPassesAutoMax);
}

// Shared conservative memory budget (bytes) for browser worker pools, derived
// from navigator.deviceMemory (GB; the spec CAPS it at 8 — a floor on true
// RAM, never the full amount) with a conservative fraction. densityPoolSize,
// interpPoolSize AND startComparePair's parallelism gate all size against
// this SAME number so they can't drift into three independently-tuned
// budgets.
function memBudgetBytes() {
  const devMemGB = navigator.deviceMemory || 4;
  return Math.max(1.5e9, devMemGB * 1e9 * 0.45);
}

// Density worker-pool size, shared by the runner and the time estimator so
// they can never drift. Each worker's resident set ≈ DEM copy (height f32 4 +
// mask u8 1 = 5 B/cell) + densityField scratch (E4 + settled1 + parents4 +
// order4 + passes-f32 4 = 17) + outputs (density-f32 4 + energySum-f64 8 +
// energyCount 4 = 16) ≈ 38 B/cell, ~55 in round mode (a second search
// resident). The optional #max-workers input lets a user on a big-RAM machine
// (which deviceMemory can't see) force more, still clamped by K.
function densityPoolSize({ N, K, round, nDirs = 8 }) {
  if (!K) return 1;
  const cores = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
  // nDirs > 8: densityField precomputes f64 long-edge cost tables per worker
  // (8 B/cell per long move, both travel directions resident in round mode)
  // — see energy-worker.js longTables. Budget them or a 16-direction run on
  // a big DEM OOMs the pool that 38 B/cell would have allowed.
  const nLong = { 16: 8, 32: 24, 64: 56, 128: 120 }[nDirs] || 0;
  const tableBytes = 8 * nLong * (round ? 2 : 1);
  const bytesPerWorker = ((round ? 55 : 38) + tableBytes) * N;
  const memCap = Math.max(1, Math.floor(memBudgetBytes() / bytesPerWorker));
  const userMax = parseInt(document.getElementById("max-workers")?.value, 10);
  const overrideN = Number.isFinite(userMax) && userMax > 0 ? userMax : 0;
  return overrideN
    ? Math.max(1, Math.min(K, overrideN))
    : Math.max(1, Math.min(K, cores, memCap));
}

// Interp worker-pool size, shared by runInterp AND the time estimate
// (predictInterpMs) so they can never drift — same rule as densityPoolSize.
// Each band worker holds the FULL grid PLUS its idwFill scratch (~15 B/cell:
// inputs 6 [energy f32 4 + mask 1 + networkMask 1] + idwFill's out Float32
// 4 + seedMask u8 1 + chamfer Int32 dist 4; the returned band slice is
// ≤4·N/P, excluded) since rays read past band edges; budgeted against
// deviceMemory (spec-capped at 8 GB) with the #max-workers override
// (clamped by the band cap). The interp runs AFTER the Dijkstra workers are
// freed (and in Cloud mode the browser never ran them), so this RAM is
// genuinely available.
function interpPoolSize(N, H) {
  const cores = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
  const memCap = Math.max(1, Math.floor(memBudgetBytes() / (15 * N)));
  const userMax = parseInt(document.getElementById("max-workers")?.value, 10);
  const overrideN = Number.isFinite(userMax) && userMax > 0 ? userMax : 0;
  const bandCap = Math.ceil(H / 64);
  return overrideN
    ? Math.max(1, Math.min(bandCap, overrideN))
    : Math.max(1, Math.min(cores, memCap, bandCap));
}

// Cache the native backend's core count from /health so the time estimate's
// backend-parallelism model reflects the actual server. Only pinged when the
// backend toggle/URL changes (not per estimate). Cleared/ignored when the
// backend is off; falls back to BACKEND_PAR_CAP if unreachable.
async function refreshBackendCores() {
  // Only Localhost probes /health on idle. Browser has no backend; Cloud's VM is
  // off between runs (and the orchestrator itself has no /health — it doesn't
  // serve density/single, just start/stop/status) — ensureCloudVm fills
  // state.backendCores at run time instead.
  if (computeMode() !== "localhost") { state.backendCores = null; estimateRunTime(); return; }
  const url = effectiveBackendUrl();
  if (!url) { state.backendCores = null; estimateRunTime(); return; }
  try {
    const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
    if (resp.ok) {
      const h = await resp.json();
      // mem_budget_bytes lets the estimate replicate the server's slice cap
      // (the dominant backend parallelism limit on huge DEMs). Older backends
      // don't send it — fall back to a default in the estimate.
      if (Number.isFinite(h.cores)) {
        state.backendCores = {
          url, cores: h.cores,
          memBudgetBytes: Number.isFinite(h.mem_budget_bytes) ? h.mem_budget_bytes : null,
          version: typeof h.version === "string" ? h.version : null,
        };
      }
    }
  } catch { /* unreachable — estimate falls back to the parallelism cap */ }
  estimateRunTime();
}

// Does the last-probed backend serve nDirs ≠ 8? The move-set port shipped in
// backend 0.2.0 — an OLDER binary silently IGNORES the params field (serde
// skips unknown keys) and would return an 8-direction field the app would
// mislabel, so the version gate is load-bearing, not cosmetic.
function backendServesNDirs() {
  const v = state.backendCores && state.backendCores.version;
  if (!v) return false;
  const [maj, min] = v.split(".").map((x) => parseInt(x, 10));
  return maj > 0 || min >= 2;
}

// Reconcile the compute-source sub-panels (Localhost URL / Cloud orchestrator)
// to the selected radio (Cloud has no origin gating — see the body comment
// below). Called on every selector change AND on load (the radiogroup is in
// PERSIST_REFIRE). Mirrors the old syncBackend's show/hide, extended to three
// states.
function syncComputeSourceUI() {
  const mode = computeMode();
  const lh = document.getElementById("localhost-extra");
  const cl = document.getElementById("cloud-extra");
  if (lh) lh.style.display = mode === "localhost" ? "" : "none";
  if (cl) cl.style.display = mode === "cloud" ? "" : "none";
  // Cloud now works from ANY origin (the orchestrator is a public Cloud Run
  // service, not loopback), so there's no origin gating — the run path requires
  // the orchestrator URL + password instead. Seed the VM-status hint when Cloud
  // is freshly shown (no VM up yet); a live boot/stop overwrites it via setCloudHint.
  if (mode === "cloud") {
    if (!state.cloud.keepaliveTimer && state.cloud.vmState !== "RUNNING") setCloudHint("cloud.idle");
  } else {
    setCloudHint(null);
  }
}

// ---- Cloud VM state machine ---------------------------------------------
// Drives the orchestrator (a public Cloud Run service) that fronts a
// pre-baked compute VM. The RUN path calls ensureCloudVm() before dispatching
// the (unchanged) backend density/single fetch against the orchestrator URL.
// The client-side keepalive marks "compute in flight" while a compute runs
// (its /cloud/keepalive traffic is a no-op on the orchestrator — the real
// cost backstop is the in-VM idle-watchdog + uptime cap); the VM is stopped
// after each run and on tab hide (a "stop VM after each run" default-ON
// behaviour). All status text goes through t(); the hint line lives in
// #cloud-vm-status.
const CLOUD_POLL_MS = 3000;       // /cloud/status poll cadence while booting
const CLOUD_KEEPALIVE_MS = 60000; // client-side keepalive cadence while computing
const CLOUD_BOOT_TIMEOUT_MS = 300000; // give the VM up to 5 min to go healthy

function setCloudHint(key, ...args) {
  const el = document.getElementById("cloud-vm-status");
  if (el) el.textContent = key ? t(key, ...args) : "";
}

// POST/GET helpers with a short timeout. Throw on transport failure (caller
// maps that to a fallback); a non-ok HTTP status throws too.
async function cloudFetchJson(url, { method = "GET", timeoutMs = 8000, body = null } = {}) {
  const headers = {};
  const tok = cloudToken();
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  let payload;
  if (body != null) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const resp = await fetch(url, { method, headers, body: payload, signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) {
    const e = new Error(`cloud HTTP ${resp.status}`);
    e.status = resp.status;          // lets callers distinguish 401 (bad password)
    throw e;
  }
  return resp.json();
}

// Ensure the cloud VM is up, then cache its core count from the data-plane
// /health. Resolves true on ready; throws (reason: orch_unreachable /
// auth_failed / boot_failed) so the caller falls back to the browser.
// `isStale` lets a superseded run bail out of the poll loop.
async function ensureCloudVm(orchUrl, isStale) {
  // Kick the (idempotent) start/create on the CONTROL plane (orchestrator).
  // machineType: the #cloud-machine selection — applied by the orchestrator
  // when the VM is created or started from STOPPED; a VM already RUNNING
  // keeps its size until the next stop (the response reports the actual type).
  let started;
  try {
    // 45 s: o start pode bloquear no resize síncrono (set_machine_type +
    // set_metadata, ~11 s medidos no n2-8; máquinas maiores/ops lentas passam
    // de 15 s) — um timeout curto aborta e cai pro navegador sem necessidade.
    started = await cloudFetchJson(`${orchUrl}/cloud/start`, {
      method: "POST", timeoutMs: 45000,
      body: { machineType: cloudMachineType() },
    });
  } catch (err) {
    state.cloud.vmState = "ERROR";
    if (err.status === 401) throw Object.assign(new Error("auth_failed"), { reason: "auth_failed", cause: err });
    throw Object.assign(new Error("orch_unreachable"), { reason: "orch_unreachable", cause: err });
  }
  state.cloud.vmState = started.state || "PROVISIONING";
  // Data plane: the VM's HTTPS host — compute + health go DIRECT here.
  const dataUrl = (started.dataUrl || "").replace(/\/+$/, "");
  state.cloud.dataUrl = dataUrl;
  if (!dataUrl) throw Object.assign(new Error("boot_failed"), { reason: "boot_failed" });

  const etaS = Number.isFinite(started.etaSeconds) ? started.etaSeconds : 60;
  // A from-scratch CREATE (no instance yet → ETA ≥ 3 min: startup-script + a
  // fresh DNS-01 cert) reads differently from a warm start, and needs a timeout
  // bigger than the 5-min default.
  const hint = etaS >= 180 ? "cloud.creating" : "cloud.starting";
  setCloudHint(hint, formatDuration(etaS * 1000));
  status.textContent = t(hint, formatDuration(etaS * 1000));
  // A from-scratch CREATE can fall back to compiling the Rust backend from
  // source (~10 min) when the operator hasn't published BACKEND_BINARY_URL —
  // widen the multiplier for that long-boot case so the client doesn't give
  // up mid-build (the same etaS>=180 threshold that picks the "creating" hint).
  const deadline = performance.now() + Math.max(CLOUD_BOOT_TIMEOUT_MS, etaS * (etaS >= 180 ? 5 : 2) * 1000);

  // Poll the DATA-plane /health directly: the orchestrator opened the firewall
  // to our IP and pointed DNS at the VM, so once it answers 200+ok the VM is
  // RUNNING, the backend is up, and the TLS cert is ready. A transport error
  // means not-ready-yet (DNS propagating / cert issuing / boot) — keep waiting.
  for (;;) {
    if (isStale && isStale()) return false;
    let h = null;
    try {
      h = await cloudFetchJson(`${dataUrl}/health`, { method: "GET", timeoutMs: 8000 });
    } catch (err) {
      if (err.status === 401) throw Object.assign(new Error("auth_failed"), { reason: "auth_failed", cause: err });
      h = null; // not reachable yet — keep polling
    }
    if (h && h.ok) {
      state.cloud.vmState = "RUNNING";
      // cores/mem_budget_bytes (snake_case from the Rust /health) feed the
      // estimate's slice model immediately.
      if (Number.isFinite(h.cores)) {
        state.backendCores = {
          url: dataUrl, cores: h.cores,
          memBudgetBytes: Number.isFinite(h.mem_budget_bytes) ? h.mem_budget_bytes : null,
          version: typeof h.version === "string" ? h.version : null,
        };
      }
      // Keep-warm + a size change in the dropdown: the running VM keeps its
      // size until the next boot — say so instead of a silent mismatch (the
      // estimate models the SELECTION, so estimate and run would disagree).
      const selSpec = CLOUD_MACHINE_SPECS[cloudMachineType()];
      if (Number.isFinite(h.cores) && selSpec && selSpec.cores !== h.cores) {
        setCloudHint("cloud.size_mismatch", h.cores, selSpec.cores);
      } else {
        setCloudHint("cloud.ready", Number.isFinite(h.cores) ? h.cores : "?");
      }
      return true;
    }
    // Occasionally check the control plane for a hard ERROR (don't fail on a
    // transient status hiccup — the /health poll above is the real readiness gate).
    try {
      const st = await cloudFetchJson(`${orchUrl}/cloud/status`, { method: "GET", timeoutMs: 8000 });
      state.cloud.vmState = st.state || state.cloud.vmState;
      if (st.state === "ERROR") throw Object.assign(new Error("boot_failed"), { reason: "boot_failed" });
      // The instance can land STOPPED (or ABSENT) while we're polling: the
      // default "stop VM after each run" behaviour means a run started right
      // after the previous one's STOPPING window completes lands exactly
      // here, and nobody would otherwise re-issue /cloud/start — the VM would
      // sit stopped until this loop's boot_failed deadline. /cloud/start is
      // documented idempotent (creates if absent, starts if stopped, no-op if
      // running), so re-kicking it is safe.
      if (st.state === "STOPPED" || st.state === "ABSENT") {
        try {
          await cloudFetchJson(`${orchUrl}/cloud/start`, {
            method: "POST", timeoutMs: 45000,
            body: { machineType: cloudMachineType() },
          });
        } catch (startErr) {
          if (startErr.status === 401) {
            throw Object.assign(new Error("auth_failed"), { reason: "auth_failed", cause: startErr });
          }
          /* transient — the next poll iteration will retry */
        }
      }
    } catch (err) {
      if (err.reason === "boot_failed" || err.reason === "auth_failed") throw err;
      if (err.status === 401) throw Object.assign(new Error("auth_failed"), { reason: "auth_failed", cause: err });
      /* transient orchestrator hiccup — keep waiting */
    }
    if (performance.now() > deadline) throw Object.assign(new Error("boot_failed"), { reason: "boot_failed" });
    await new Promise((r) => setTimeout(r, CLOUD_POLL_MS));
  }
}

// Client-side keepalive: marks "a cloud compute is in flight" for the
// duration of the run (it's beaconStopCloudVm's in-flight signal). Its
// /cloud/keepalive traffic ALSO registers/renews this tab's short-lived
// orchestrator lease (X-Simu-Client → LEASES[clientId], ~180s TTL) so a
// concurrent second browser's default "stop after run" can't kill the VM
// out from under this run. The in-VM idle-watchdog (~15 min) + uptime cap
// remain the real cost backstops regardless of any lease. Cleared by
// stopCloudKeepalive().
function startCloudKeepalive(orchUrl) {
  stopCloudKeepalive();
  const tok = cloudToken();
  const headers = { "X-Simu-Client": cloudClientId() };
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  state.cloud.keepaliveTimer = setInterval(() => {
    fetch(`${orchUrl}/cloud/keepalive`, { method: "POST", headers, signal: AbortSignal.timeout(8000) })
      .catch(() => { /* best-effort — the in-VM watchdog reaps regardless */ });
  }, CLOUD_KEEPALIVE_MS);
}
function stopCloudKeepalive() {
  if (state.cloud.keepaliveTimer) { clearInterval(state.cloud.keepaliveTimer); state.cloud.keepaliveTimer = null; }
}

// Stop the VM now (default-ON "stop after each run"). Best-effort: a POST with
// a short timeout from the in-page path, or a sendBeacon from a page-hide
// handler (which can't await). Always clears the keepalive first. Carries
// X-Simu-Client so the orchestrator can skip the stop if another client's
// lease (from ITS keepalive) is still active — see LEASES in orchestrator/main.py.
function stopCloudVm(orchUrl, { beacon = false } = {}) {
  stopCloudKeepalive();
  if (!orchUrl) return;
  const tok = cloudToken();
  const headers = { "X-Simu-Client": cloudClientId() };
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  if (beacon) {
    // On page-hide we can't await; fetch({keepalive:true}) survives the unload
    // AND carries the Authorization/X-Simu-Client headers (sendBeacon CAN'T set
    // headers, so the orchestrator would 401 it or lose the lease check). Best-effort.
    try { fetch(`${orchUrl}/cloud/stop`, { method: "POST", headers, keepalive: true }); }
    catch { /* best-effort */ }
    state.cloud.vmState = "STOPPING";
    return;
  }
  setCloudHint("cloud.stopping");
  state.cloud.vmState = "STOPPING";
  fetch(`${orchUrl}/cloud/stop`, { method: "POST", headers, signal: AbortSignal.timeout(8000) })
    .then((resp) => resp.json().catch(() => ({})))
    .then((body) => {
      // A concurrent client's active lease makes the orchestrator SKIP the
      // stop and report the VM's real (still-running) state — reflect that
      // instead of claiming STOPPED, or this tab's UI would lie.
      if (body && body.skipped) {
        state.cloud.vmState = body.state || "RUNNING";
        setCloudHint("cloud.stop_skipped");
      } else {
        state.cloud.vmState = "STOPPED";
        setCloudHint("cloud.stopped_after");
      }
    })
    .catch(() => { /* best-effort — the in-VM watchdog reaps it anyway */ });
}

// Calibration probe: each ref runs an UNBUDGETED search stopped after
// PROBE_MAX_SETTLED cells. Capping by cell count (not energy budget) bounds the
// probe's wall time regardless of DEM size — the ≤3 s (ideally ≤1 s) target —
// while anchoring the estimate at an unsaturated point, which fixes the old
// fixed-budget model's up-to-3.8× error on small DEMs it saturated. The few
// spread refs (not 2 central ones) average out per-ref placement variance.
const PROBE_MAX_SETTLED = 1_000_000;
const PROBE_REFS = 3;

// One-shot, off-thread calibration of the compute-time estimate for the
// current DEM. Runs PROBE_REFS budgeted Dijkstras in a dedicated worker,
// measuring the one-time allocation cost and the per-ref search throughput,
// so estimateRunTime() can scale with the energy budget instead of a fixed
// full-grid rate. Generation-guarded (a new DEM load drops a stale result);
// deferred while a real compute is running so it doesn't steal cores.
function startCalibrationProbe() {
  if (!state.dem) return;
  if (state.computeStartedAt) return; // a compute is running — retried in computeDone
  if (state.probeWorker) { state.probeWorker.terminate(); state.probeWorker = null; }

  const { H, W } = state.dem;
  // Probe the EFFECTIVE compute grid (impassable blocked, corridors reopened)
  // so the time estimate reflects the terrain a real run actually traverses.
  const { height: probeHeight, mask } = buildComputeGrid();
  // Two deterministic interior, on-mask reference cells (sample real relief,
  // not a corner). Spiral out from each target to the nearest valid cell.
  const findValid = (r0, c0) => {
    for (let rad = 0; rad < Math.max(H, W); rad++) {
      for (let dr = -rad; dr <= rad; dr += Math.max(1, 2 * rad)) {
        const r = r0 + dr;
        if (r < 0 || r >= H) continue;
        for (let dc = -rad; dc <= rad; dc++) {
          const c = c0 + dc;
          if (c < 0 || c >= W) continue;
          if (mask[r * W + c]) return [r, c];
        }
      }
    }
    return null;
  };
  const refs = [];
  for (const [fr, fc] of [[0.5, 0.5], [0.3, 0.35], [0.7, 0.65]]) {
    const v = findValid(Math.round(fr * H), Math.round(fc * W));
    if (v) refs.push(v);
  }
  if (refs.length < 2) return; // degenerate mask; estimate stays uncalibrated

  const probeGen = state.calibrationGen;
  const cost = readCost();

  const w = new Worker(WORKER_URL);
  state.probeWorker = w;
  w.onmessage = (ev) => {
    const m = ev.data;
    if (m.kind === "error") {
      // The probe threw in the worker — don't leak the worker or leave the
      // estimate stuck on "estimating…" until the next DEM load. Flag the
      // failure so estimateRunTime blanks instead; computeDone retries later.
      console.warn("[probe] calibration probe failed:", m.message);
      w.terminate();
      if (state.probeWorker === w) state.probeWorker = null;
      if (probeGen === state.calibrationGen) { state.calibrationFailed = true; estimateRunTime(); }
      return;
    }
    if (m.kind !== "probe-done") return;
    w.terminate();
    if (state.probeWorker === w) state.probeWorker = null;
    if (probeGen !== state.calibrationGen) return; // superseded by a newer DEM
    // Anchor this DEM/terrain's compute model at the probe's UNSATURATED
    // cell-capped point (Estar cells reached at budget bStar, in perRefProbe
    // ms incl. the passes walk). The estimate then scales:
    //   explored(eMax,alpha) = min(N, Estar·(eMax·αprobe/(bStar·α))^EXPLORE_EXP)
    //   perRef(explored)     = perRefProbe·(explored/Estar)^RATE_EXP
    // Anchoring at an unsaturated point (vs the old fixed budget that
    // saturated small DEMs) is what fixes the up-to-3.8× small-DEM error;
    // online correction absorbs the residual exponent/scale drift.
    const Estar = Math.max(1, m.exploredTotal / m.nRefs);
    const bStar = Math.max(1, m.budgetReached);
    const perRefProbe = Math.max(0.01, (m.totalMs - m.allocMs) / m.nRefs);
    state.calibration = {
      N: m.N,
      allocMsN: m.allocMs,
      Estar, bStar, perRefProbe,
      alphaAtProbe: costAlphaEquiv(cost),
      // Online correction: actual/predicted from completed computes, per
      // PHASE/engine (the backend's native-speedup × slice-contention factor,
      // the graph engine's per-edge cost, and the interp fill rate are all
      // scale-/network-dependent, so we learn them rather than guess).
      corrBrowser: 1, corrBackend: 1, corrGraph: 1, corrInterp: 1,
    };
    estimateRunTime();
  };
  w.onerror = () => {
    w.terminate();
    if (state.probeWorker === w) state.probeWorker = null;
    if (probeGen === state.calibrationGen) { state.calibrationFailed = true; estimateRunTime(); }
  };

  // Cell cap: bound the probe's search time (the 3 s / ~1 s target) yet stay
  // unsaturated. min(fixed, 0.4·N) keeps it < N (so it always anchors below
  // full grid). On a 135 M-cell DEM ≈ 3×1 M cells ≈ ~1 s search + first-touch.
  const N = H * W;
  const maxSettled = Math.min(PROBE_MAX_SETTLED, Math.max(50_000, Math.floor(0.4 * N)));
  w.postMessage(
    {
      kind: "probe",
      height: probeHeight, mask, H, W,
      dx: state.dem.dxM, dy: state.dem.dyM,
      cost, maxSettled,
      refPoints: refs,
    },
    [probeHeight.buffer, mask.buffer],
  );
  state.calibrationFailed = false; // a fresh probe is in flight
  estimateRunTime(); // show "estimating…" until the probe lands
}

// ------- Compute-time estimation -------
// Calibrated by a per-DEM two-budget probe at load (state.calibration; see
// startCalibrationProbe), which anchors this DEM/terrain at an unsaturated
// cell-capped probe point (Estar cells at budget bStar, perRefProbe ms):
//   explored(eMax,alpha) = min(N, Estar·(eMax·alphaAtProbe/(bStar·alpha))^EXPLORE_EXP)
//   perRef(explored)     = perRefProbe·(explored/Estar)^RATE_EXP
// plus allocMsN (one-time scratch alloc). Online-corrected per engine
// (corrBrowser/corrBackend) from completed computes.
// Tunables:
const EXPLORE_EXP     = 2.1;  // explored ∝ reach^EXPLORE_EXP (reach ∝ eMax/alpha;
                              // area ∝ reach², ~2.1 measured on real terrain).
const RATE_EXP        = 1.1;  // perRef ∝ explored^RATE_EXP (>1 = cache
                              // rate-degradation as the frontier outgrows cache).
const NATIVE_SPEEDUP  = 1.6;  // native per-ref speedup vs JS — nominal; both
                              // converge toward bandwidth-bound on huge
                              // frontiers (~1.3) and diverge on small ones
                              // (~2.4). Online correction adjusts the residual.
const BW_CONTENTION   = 0.2;  // shared-memory-bandwidth penalty coefficient.
                              // Applied SUB-linearly (√(slices−1), below): the
                              // linear USL form was tuned in the 1–2-slice
                              // regime (huge DEMs, RAM-capped) where both agree,
                              // but extrapolated linearly it capped ANY machine
                              // at 1/κ = 5× total speedup — 128 vCPUs estimated
                              // a mere 1.4× faster than 8 on a mid-size DEM
                              // (visto na prática). √ keeps contention growing
                              // with concurrency without that absurd ceiling;
                              // PROVISÓRIO até timings reais em 32/128 vCPUs
                              // treinarem a correção (corrBackend é um escalar
                              // por MOTOR — não absorve erro de FORMA entre
                              // tamanhos de máquina).
const BACKEND_PAR_CAP = 8;    // fallback core count when /health is unreachable
// Per-slice scratch+accumulator bytes/cell in the backend (mirrors
// backend/src/main.rs: 17 scratch + 20 acc; round doubles scratch + 1 byte).
const BACKEND_BYTES_PER_CELL = 37;
const BACKEND_BYTES_PER_CELL_ROUND = 55;
// Cloud transfer-size estimate: assumed wire bandwidth (megabits/s) for the
// up/down byte counts → a rough wall-time guess. Nominal home/office values;
// the estimate is informational only (it never gates a run).
const UPLINK_MBPS   = 50;
const DOWNLINK_MBPS = 200;
// Network-graph ("follow the vectors") compute: a graph Dijkstra is ∝ EDGES,
// not raster cells — orders of magnitude cheaper than the grid, so the raster
// model massively over-estimates it. Nominal; corrGraph tunes per network.
const GRAPH_MS_PER_EDGE = 5e-5;
// Network IDW interpolation (separate phase; often DOMINATES when the compute
// is network-constrained or on the graph, since it fills the whole grid while
// the compute touches only network cells/edges). Nominal per-cell rates;
// corrInterp tunes. Fill scales with the ray search distance.
const INTERP_MS_PER_CELL = 5e-6;        // per cell per maxDist unit (banded)
const INTERP_SMOOTH_MS_PER_CELL = 5e-6; // per cell per 3×3 smoothing pass (banded)

// Graph edge count for the graph-mode estimate — the built graph if cached,
// else the network polyline segment count (≈ edges) before it's built.
function networkEdgeCount() {
  if (state.networkGraph && state.networkGraph.nEdges) return state.networkGraph.nEdges;
  if (state.networkLines && state.networkLines.length) {
    let v = 0;
    for (const ln of state.networkLines) v += Math.max(0, ln.length - 1);
    return Math.max(1, v);
  }
  return 0;
}

// Graph-mode compute: per-ref graph Dijkstra ∝ edges (round = both legs).
function predictGraphComputeMs(opts) {
  const dijk = opts.mode === "round" ? 2 : 1;
  const refs = opts.wantDensity ? (opts.refs || 1) : 1;
  return refs * Math.max(1, opts.netEdges) * GRAPH_MS_PER_EDGE * dijk;
}

// Network interpolation phase (0 when not interpolating). Graph-mode interp
// runs single-worker; raster-constrained interp is banded across the pool.
function predictInterpMs(opts) {
  if (!opts.interp || !(opts.N > 0)) return 0;
  const poolN = opts.graph ? 1 : interpPoolSize(opts.N, state.dem?.H || 1);
  const fill = INTERP_MS_PER_CELL * opts.N * Math.max(1, opts.interpMaxDist || 50);
  const smooth = INTERP_SMOOTH_MS_PER_CELL * opts.N * (opts.smoothIters || 0);
  // The IDW fill is banded across the pool; smoothing is a single post-merge
  // worker pass, so it is NOT divided by poolN (poolN=1 in graph mode → same).
  return fill / poolN + smooth;
}

function exploredCells(cal, N, eMax, alpha) {
  if (!(eMax > 0)) return N; // no budget → full grid
  // flat reach ∝ eMax/alpha; anchored at (bStar, Estar) from the probe.
  const ratio = (eMax * cal.alphaAtProbe) / (cal.bStar * alpha);
  return Math.min(N, cal.Estar * Math.pow(ratio, EXPLORE_EXP));
}

// Pre-flight compute-time prediction in ms (raw, before the network-interp
// term). Shared by the live estimate and the online-correction update so they
// can't drift. `applyCorr` multiplies in the learned per-engine factor.
// Move-directions cost multipliers vs the 8-move probe anchor (measured in
// docs/grid-sens.mjs / docs/grid-longedge.mjs on the SP DTM; 64/128
// extrapolated from edge-count scaling). Density runs amortize precomputed
// long-edge tables across their refs, so they use the cheaper lookup-search
// factors; single-source runs integrate on demand. The per-engine online
// correction (corrBrowser) absorbs the residual per-machine scale.
const DIRS_COST_SINGLE  = { 4: 0.7, 8: 1, 16: 2.4, 32: 5.8, 64: 15, 128: 38 };
const DIRS_COST_DENSITY = { 4: 0.7, 8: 1, 16: 1.5, 32: 2.7, 64: 8,  128: 18 };

function predictComputeMs(cal, opts, applyCorr) {
  const { N, wantDensity, wantTopN, refs, eMax, mode, alpha, backend, graph } = opts;

  // "Follow the vectors": cost is ∝ graph edges, not raster cells (~1000× less
  // on a typical network/DEM). Using the raster model here is the severe
  // over-estimate users hit in graph mode.
  if (graph) {
    let ms = predictGraphComputeMs(opts);
    // Compare adds a full-DEM unconstrained RASTER scenario (single-point or
    // density pool) — add its cost via the raster model (graph off, browser).
    if (opts.graphCompare) ms += predictComputeMs(cal, { ...opts, graph: false, backend: false }, false);
    return applyCorr ? ms * (cal.corrGraph || 1) : ms;
  }

  const explored = exploredCells(cal, N, eMax, alpha);
  const dirsTable = wantDensity ? DIRS_COST_DENSITY : DIRS_COST_SINGLE;
  const dirsFactor = dirsTable[opts.nDirs || 8] || 1;
  const perRef = cal.perRefProbe * Math.pow(explored / cal.Estar, RATE_EXP) * dirsFactor;
  const dijk = mode === "round" ? 2 : 1;

  let ms, corr = 1;
  if (wantDensity) {
    if (backend) {
      // Native backend: per-ref speedup, parallel across refs but capped by
      // the server's MEMORY-bounded slice count (the dominant factor on huge
      // DEMs — each slice holds full-grid scratch, so 1-2 fit in RAM, not
      // cores-many) and slowed by shared-bandwidth contention between slices.
      // nDirs > 8 (backend ≥ 0.2.0): parent_long adds 1 B/cell per scratch
      // (37→38, 55→57 round), and the request-shared long-edge cost tables
      // ((nDirs−8) tables × 8 B/cell × revs) come off the budget ONCE before
      // the per-slice division — mirrors backend/src/main.rs's budget math.
      const nd = opts.nDirs || 8;
      const nLong = Math.max(0, nd - 8);
      const revs = mode === "round" ? 2 : 1;
      const perSlice = ((mode === "round" ? BACKEND_BYTES_PER_CELL_ROUND : BACKEND_BYTES_PER_CELL)
                        + (nLong ? revs : 0)) * N;
      const spec = backendSpecForEstimate();
      const memBudget = Math.max(1, (spec.memBudgetBytes || 8e9) - revs * nLong * 8 * N);
      const memCap = Math.max(1, Math.floor(memBudget / perSlice));
      const cores = spec.cores || BACKEND_PAR_CAP;
      const slices = Math.max(1, Math.min(refs || 1, cores, memCap));
      const contention = 1 + BW_CONTENTION * Math.sqrt(slices - 1);
      ms = (refs / slices) * (perRef / NATIVE_SPEEDUP) * contention * dijk;
      corr = cal.corrBackend || 1;
    } else {
      // Browser worker pool: per-ref work splits across poolN; each worker
      // pays its own alloc, overlapping in wall-clock (so allocMsN once).
      const poolN = densityPoolSize({ N, K: refs, round: mode === "round", nDirs: opts.nDirs || 8 });
      ms = cal.allocMsN + (refs / poolN) * perRef * dijk;
      corr = cal.corrBrowser || 1;
    }
  } else if (backend && !wantTopN && !opts.maximize && !opts.wantPath) {
    // Native backend single-source (POST /single) — same dispatch gate as the
    // runner. No per-worker browser DEM alloc; native per-Dijkstra speedup.
    // corrBackend is trained by density backend runs (a reasonable proxy — the
    // online correction skips the fast single-point modes by design).
    ms = (perRef / NATIVE_SPEEDUP) * dijk;
    corr = cal.corrBackend || 1;
  } else {
    // Single-point modes (from/to/round) — one Dijkstra (two for round).
    ms = cal.allocMsN + perRef * dijk;
    if (wantTopN) {
      const k = Math.max(1, Math.min(20, parseInt(document.getElementById("n-routes")?.value, 10) || 3));
      const rep = document.getElementById("repulsion-mode")?.value || "per-cell";
      const perIter = rep === "per-cell" ? 0.5 : 0.8;
      ms += perRef * perIter * k;
    }
    corr = cal.corrBrowser || 1;
  }
  return applyCorr ? ms * corr : ms;
}

// Read the current run config from the DOM (used by both the estimate and the
// post-compute correction, so they describe the same run).
function currentRunOpts(cal, N) {
  const mode = document.getElementById("mode")?.value || "from";
  // The v2 analogue of v1's α for the reach model (flat reach ∝ eMax/alpha).
  const alpha = costAlphaEquiv(readCost()) || cal.alphaAtProbe;
  const eMaxRaw = parseFloat(document.getElementById("e-max")?.value);
  const graph = graphModeActive();
  // Interp runs when its toggle is on AND there's a network to fill around —
  // either a raster constraint or graph mode (graph energy is IDW-filled too).
  const interp = !!document.getElementById("net-interp")?.checked
    && (networkConstraintActive() || graph);
  return {
    N,
    wantDensity: !!document.getElementById("want-density")?.checked,
    wantTopN: !!document.getElementById("want-topn")?.checked,
    // maximize / a destination path keep single-source runs in the browser (the
    // backend produces no routes) — the predictor gates the backend arm on these.
    maximize: !!document.getElementById("maximize")?.checked,
    wantPath: !!state.dst,
    refs: state.refPoints?.length || 0,
    // Mirror the runner: the kJ budget is ignored under maximize (inverted
    // costs), so the reach model must assume full grid there too.
    eMax: !document.getElementById("maximize")?.checked && Number.isFinite(eMaxRaw) && eMaxRaw > 0 ? eMaxRaw : 0,
    mode, alpha,
    // nDirs ≠ 8 always computes in-browser (the backend serves the classic
    // 8-move engine only) — the predictor must mirror the runner's gate.
    nDirs: (() => { const v = parseInt(document.getElementById("n-dirs")?.value, 10); return [4, 8, 16, 32, 64, 128].includes(v) ? v : 8; })(),
    // nDirs ≠ 8 runs on the backend when it's ≥ 0.2.0; cloud assumes the
    // deployed binary is current (we control it), localhost asks the probe.
    backend: computeMode() !== "browser" && (() => {
      const nd = parseInt(document.getElementById("n-dirs")?.value, 10) || 8;
      return nd === 8 || computeMode() === "cloud" || backendServesNDirs();
    })(),
    graph,
    // Graph-mode compare also runs a full-DEM unconstrained raster scenario.
    graphCompare: graph && !!document.getElementById("vec-compare")?.checked,
    netEdges: graph ? networkEdgeCount() : 0,
    interp,
    interpMaxDist: Math.max(1, parseInt(document.getElementById("net-interp-max-dist")?.value, 10) || 50),
    smoothIters: Math.max(0, parseInt(document.getElementById("net-interp-smoothing")?.value, 10) || 0),
  };
}

function estimateRunTime() {
  // Cloud transfer-size estimate (always reconciled — even before a DEM/probe).
  updateCloudTransferEstimate();

  const out = document.getElementById("time-estimate");
  if (!out) return;
  if (!state.dem) { out.textContent = ""; return; }

  const cal = state.calibration;
  if (!cal) {
    // Probe errored → no anchor for a number; stay blank instead of showing
    // "estimating…" forever (computeDone retries the probe after each run).
    out.textContent = state.calibrationFailed ? "" : t("estimate.calibrating");
    return;
  }

  const N = state.dem.H * state.dem.W;
  const opts = currentRunOpts(cal, N);
  // Two phases, separately corrected: compute (raster/backend/graph) + the
  // network interpolation fill (frequently the larger of the two).
  let ms = predictComputeMs(cal, opts, true);
  ms += predictInterpMs(opts) * (cal.corrInterp || 1);
  out.textContent = `≈ ${formatDuration(ms)}`;
}

// Cloud-only: estimate the bytes shipped to/from the orchestrator for the
// current run config and render them (+ a wire-time guess) into #cloud-transfer.
// Pulls the same inputs estimateRunTime uses. Cleared when not in cloud mode or
// when there's no DEM to size against.
function updateCloudTransferEstimate() {
  const line = document.getElementById("cloud-transfer");
  if (!line) return;
  if (computeMode() !== "cloud" || !state.dem) { line.textContent = ""; return; }

  const N = state.dem.H * state.dem.W;
  const mode = document.getElementById("mode")?.value || "from";
  const wantDensity = !!document.getElementById("want-density")?.checked;
  const hasNetwork  = networkConstraintActive();
  const nPortals    = buildPortals()?.n || 0;

  // Upload: gridHeight (f32 → 4·N) + gridMask (u8 → N) + optional networkMask
  // (u8 → N) + the bridge portal arrays (~32 B/portal: 2×i32 + 3×f64). The JSON
  // header is negligible against the grid.
  const up = 4 * N + N + (hasNetwork ? N : 0) + nPortals * 32;
  // Download: density returns f64 density (8·N) + f32 energy (4·N); single
  // returns f32 energy (4·N) + f64 passes (8·N — always on since v68; the
  // /single wire ships passes as f64 to match the JS worker's Float64Array).
  const down = wantDensity ? (8 * N + 4 * N) : (4 * N + 8 * N);
  // Rough wire time at the assumed link speeds (bytes·8 / (Mbps·1e6)).
  const wireMs = (up * 8 / (UPLINK_MBPS * 1e6) + down * 8 / (DOWNLINK_MBPS * 1e6)) * 1000;
  line.textContent = t("cloud.transfer", formatBytes(up), formatBytes(down), formatDuration(wireMs));
}

// Online correction: after a run finishes, nudge the per-PHASE correction
// toward actual/predicted so subsequent estimates converge to this machine's
// reality (EMA, clamped). The compute phase keys by engine (browser/backend/
// graph); the interp phase has its own factor — keeping them separate stops
// a slow interp from inflating the compute correction (and vice-versa).
function updateEstimateCorrection(computeMs, interpMs) {
  const cal = state.calibration, lr = state.lastRun;
  if (!cal || !lr) return;
  const nudge = (key, actual, predicted) => {
    if (!(actual > 0) || !(predicted > 0)) return;
    const ratio = Math.min(5, Math.max(0.2, actual / predicted));
    cal[key] = Math.min(5, Math.max(0.2, 0.5 * (cal[key] || 1) + 0.5 * ratio));
  };
  // Correct the compute phase only for the perf-critical paths (density and
  // graph), not the fast single-point modes — they share corrBrowser but have
  // a different cost shape, so learning from them would muddy the density one.
  if (computeMs > 0 && (lr.wantDensity || lr.graph)) {
    const key = lr.graph ? "corrGraph" : (lr.backend ? "corrBackend" : "corrBrowser");
    nudge(key, computeMs, predictComputeMs(cal, lr, false));
  }
  if (interpMs > 0 && lr.interp) {
    nudge("corrInterp", interpMs, predictInterpMs(lr));
  }
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 950) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}

// Binary-unit byte formatter for the cloud transfer estimate (KiB/MiB/GiB).
function formatBytes(b) {
  if (!Number.isFinite(b) || b < 0) return "—";
  if (b < 1024) return `${Math.round(b)} B`;
  const u = ["KiB", "MiB", "GiB", "TiB"];
  let v = b / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

function formatEnergy(v) {
  if (!Number.isFinite(v) || v === 0) return "0";
  const a = Math.abs(v);
  // Plain decimal, never scientific — energy reads as e.g. "3357", not "3.3e+3".
  // Large values stay whole; smaller ones keep 1–2 decimals for precision.
  if (a >= 100) return v.toFixed(0);
  if (a >= 10)  return v.toFixed(1);
  return v.toFixed(2);
}

// Always-scientific formatter — passes/density bounds span many orders of
// magnitude (≈1e-9…1e-3), so fixed notation is unreadable; show e.g. "3.8e-9".
function formatSci(v) {
  if (!Number.isFinite(v) || v === 0) return "0";
  return v.toExponential(1);
}

// ------- DEM metadata formatters -------
function formatCellSize(dx, dy, originY, H, isGeographic) {
  if (isGeographic) {
    const latRef = originY - (H * dy) / 2;
    const dxM = dx * 111320 * Math.cos((latRef * Math.PI) / 180);
    const dyM = dy * 110574;
    return `<span class="v">${dxM.toFixed(1)} × ${dyM.toFixed(1)} m</span> <span style="opacity:0.6">(${dx.toExponential(2)}° × ${dy.toExponential(2)}°)</span>`;
  }
  return `<span class="v">${dx.toFixed(1)} × ${dy.toFixed(1)} m</span>`;
}

function formatCoverage(W, H, dx, dy, originY, isGeographic) {
  let xKm, yKm;
  if (isGeographic) {
    const latRef = originY - (H * dy) / 2;
    xKm = (W * dx * 111320 * Math.cos((latRef * Math.PI) / 180)) / 1000;
    yKm = (H * dy * 110574) / 1000;
  } else {
    xKm = (W * dx) / 1000;
    yKm = (H * dy) / 1000;
  }
  return t("dem.meta_coverage", `<span class="v">${xKm.toFixed(2)} × ${yKm.toFixed(2)} km</span>`);
}

// ------- ColorCET colormaps -------
// Auto-generated from the python `colorcet` package — full set, ~75 maps.
// Each entry: 17 anchor RGB triples sampled evenly from the 256-stop palette
// (Kovesi 2015, https://colorcet.com/). Maps are designed to be uniform under
// CIECAM02 rather than the simpler L* CIELab metric matplotlib uses, so they
// hold up better at the extremes.
const COLORMAPS = {
  CET_L1: [[0,0,0],[19,19,19],[32,32,32],[45,45,45],[59,59,59],[73,73,73],[88,88,88],[103,103,103],[119,119,119],[134,134,134],[150,150,150],[167,167,167],[184,184,184],[201,201,201],[219,219,219],[236,236,236],[254,255,255]],
  CET_L2: [[27,27,27],[38,38,38],[49,49,49],[61,61,61],[73,73,73],[86,86,86],[99,99,99],[112,112,112],[125,125,125],[138,138,138],[152,152,152],[166,166,166],[180,180,180],[195,195,195],[210,210,210],[225,225,225],[240,240,240]],
  CET_L3: [[0,0,0],[50,0,0],[74,0,0],[99,1,0],[125,2,0],[152,3,0],[180,5,0],[209,9,0],[237,20,0],[251,61,0],[254,102,0],[255,135,0],[255,164,1],[255,191,3],[255,217,9],[255,241,30],[255,255,255]],
  CET_L4: [[0,0,0],[49,0,0],[73,0,0],[97,1,0],[122,2,0],[148,3,0],[175,5,0],[203,8,0],[231,16,0],[246,54,0],[250,95,0],[252,127,0],[253,156,0],[254,182,0],[254,207,0],[254,231,0],[255,255,0]],
  CET_L5: [[0,21,5],[9,33,5],[8,47,4],[10,61,4],[14,76,5],[18,91,6],[22,106,7],[26,122,9],[31,138,11],[34,153,13],[39,170,14],[43,187,16],[47,204,18],[52,222,20],[83,238,21],[150,249,21],[216,255,20]],
  CET_L6: [[0,0,78],[5,2,110],[15,1,144],[10,4,181],[12,16,213],[31,34,238],[43,59,249],[47,85,251],[45,108,253],[43,129,253],[51,149,253],[53,169,252],[43,189,252],[41,209,250],[73,227,249],[128,242,247],[179,254,245]],
  CET_L7: [[0,2,75],[0,5,108],[5,5,143],[4,8,179],[22,15,212],[54,24,238],[101,28,250],[147,28,253],[186,28,253],[217,39,253],[239,65,254],[251,97,253],[254,130,252],[254,159,252],[254,186,253],[254,210,254],[254,234,254]],
  CET_L8: [[0,14,92],[14,21,118],[45,26,138],[86,24,146],[124,16,144],[157,10,140],[186,11,133],[212,24,125],[232,51,112],[243,79,96],[248,108,82],[248,136,71],[250,160,61],[252,182,55],[252,205,59],[249,226,67],[245,248,77]],
  CET_L9: [[5,0,171],[11,33,176],[13,55,180],[12,74,180],[6,93,173],[25,112,151],[43,130,120],[49,147,84],[65,161,55],[89,173,33],[121,185,12],[155,194,2],[188,203,8],[217,213,26],[239,224,50],[250,239,102],[249,249,249]],
  CET_L10: [[101,154,143],[113,158,136],[125,161,129],[139,164,123],[155,166,117],[176,165,113],[194,165,111],[206,167,108],[211,171,105],[214,176,105],[216,181,112],[216,187,125],[215,192,143],[215,197,160],[214,202,177],[213,207,194],[212,212,212]],
  CET_L11: [[111,172,91],[132,174,93],[151,175,95],[168,175,97],[184,176,99],[199,177,101],[213,178,104],[224,180,106],[230,184,109],[231,189,114],[231,195,124],[231,200,138],[230,206,156],[229,211,173],[228,216,191],[227,221,208],[226,226,226]],
  CET_L12: [[240,240,240],[228,233,239],[216,225,238],[203,217,236],[191,210,235],[179,203,232],[167,195,229],[156,188,225],[146,180,220],[138,173,214],[129,166,207],[121,158,199],[112,151,193],[101,144,188],[89,137,184],[75,130,180],[58,123,177]],
  CET_L13: [[0,0,0],[27,5,0],[43,8,0],[55,10,0],[67,12,0],[79,15,0],[92,17,0],[105,19,0],[118,22,0],[130,24,0],[144,27,0],[157,29,0],[171,32,0],[186,35,0],[200,37,0],[214,40,0],[229,43,0]],
  CET_L14: [[0,0,0],[0,14,0],[0,23,0],[0,30,0],[0,37,0],[0,44,0],[0,51,0],[0,58,0],[0,65,0],[0,72,0],[0,79,0],[0,87,0],[0,95,0],[0,103,0],[0,111,0],[0,119,0],[0,127,0]],
  CET_L15: [[0,0,0],[2,9,28],[4,15,48],[6,20,62],[7,25,75],[8,29,89],[10,34,103],[11,38,117],[13,43,132],[14,48,145],[16,53,160],[17,58,176],[19,63,191],[20,68,207],[22,73,222],[23,78,238],[25,84,255]],
  CET_L16: [[16,16,16],[32,19,69],[33,21,119],[22,29,161],[8,48,181],[6,71,183],[5,95,172],[32,117,143],[47,138,103],[57,156,66],[84,172,37],[122,185,11],[163,196,2],[201,207,15],[232,220,40],[248,236,87],[249,249,249]],
  CET_L17: [[254,255,255],[246,242,210],[242,228,175],[242,211,149],[243,192,130],[244,173,116],[245,153,107],[243,132,103],[239,111,105],[233,90,108],[222,69,115],[207,50,124],[189,34,134],[164,24,144],[133,28,154],[91,35,161],[0,42,167]],
  CET_L18: [[254,255,255],[245,247,213],[237,238,181],[233,228,157],[231,216,136],[229,204,116],[228,192,98],[228,179,82],[227,166,67],[226,153,55],[225,139,43],[224,124,35],[223,109,28],[221,92,24],[219,73,24],[216,51,26],[212,15,29]],
  CET_L19: [[254,255,255],[234,247,253],[216,238,253],[200,229,253],[190,218,254],[185,206,254],[184,192,251],[190,178,245],[199,162,235],[209,146,222],[220,127,203],[228,108,179],[234,87,152],[235,67,122],[231,49,89],[222,37,55],[208,33,14]],
  CET_L20: [[48,48,48],[60,53,88],[66,60,127],[66,69,161],[62,80,188],[55,96,200],[40,118,182],[37,138,149],[65,154,117],[104,164,89],[147,172,59],[187,178,30],[228,182,19],[247,193,20],[254,209,18],[253,228,15],[248,248,9]],
  CET_D1: [[32,80,218],[81,98,222],[112,117,225],[137,136,228],[160,156,231],[181,176,234],[201,197,236],[221,218,238],[237,231,233],[241,214,208],[240,190,177],[236,165,147],[231,140,118],[223,114,90],[214,87,63],[203,57,36],[191,2,5]],
  CET_D1A: [[23,41,113],[28,58,161],[40,78,207],[81,100,230],[119,125,243],[153,151,252],[185,180,250],[213,209,245],[238,226,230],[250,202,191],[252,165,146],[248,126,104],[232,91,70],[212,53,39],[184,6,15],[143,3,9],[102,7,2]],
  CET_D2: [[56,150,14],[85,162,51],[110,173,79],[133,184,106],[155,196,132],[176,207,158],[198,218,185],[219,229,212],[235,234,235],[234,221,239],[229,203,238],[222,185,237],[215,166,235],[208,148,233],[200,129,232],[192,109,230],[183,89,228]],
  CET_D3: [[56,150,14],[85,162,51],[110,173,79],[133,184,106],[155,196,132],[176,207,158],[198,218,185],[219,229,212],[238,234,230],[245,220,216],[248,201,194],[250,181,171],[250,161,150],[248,140,128],[245,119,108],[241,96,87],[236,71,68]],
  CET_D4: [[24,129,250],[40,115,219],[47,101,188],[49,88,159],[49,75,130],[46,62,102],[41,50,76],[35,38,51],[34,31,32],[51,35,32],[75,42,36],[99,49,41],[124,56,46],[149,62,51],[175,68,55],[202,74,60],[230,79,65]],
  CET_D6: [[14,147,250],[36,131,218],[44,114,188],[47,99,158],[48,83,130],[45,68,102],[41,54,76],[35,40,51],[33,32,32],[45,39,29],[63,52,31],[81,65,32],[100,79,33],[119,94,33],[138,108,32],[158,123,29],[179,138,25]],
  CET_D7: [[19,49,193],[59,60,187],[80,72,182],[96,84,176],[108,96,170],[119,108,164],[129,120,157],[137,132,151],[145,144,144],[160,154,135],[174,164,124],[189,174,113],[202,184,101],[215,195,88],[228,206,72],[240,216,51],[252,227,9]],
  CET_D8: [[0,42,215],[37,50,200],[62,57,185],[76,65,171],[86,72,157],[92,79,142],[96,86,128],[99,93,114],[101,100,99],[124,98,90],[147,94,80],[167,90,70],[187,84,59],[205,77,48],[224,67,36],[242,52,21],[255,24,0]],
  CET_D9: [[36,127,254],[89,141,254],[121,155,254],[147,170,253],[170,185,253],[191,200,252],[211,216,251],[230,232,250],[248,246,246],[252,228,222],[253,208,197],[253,188,172],[251,167,147],[247,147,123],[243,126,100],[237,104,77],[230,80,54]],
  CET_D10: [[0,216,255],[82,221,255],[119,226,255],[148,231,255],[172,236,255],[195,241,255],[216,245,255],[236,250,255],[254,254,254],[254,245,253],[254,235,251],[254,225,249],[253,214,247],[253,204,245],[252,194,243],[251,184,242],[249,173,240]],
  CET_D11: [[0,182,255],[61,180,247],[91,179,236],[112,178,225],[128,176,214],[141,175,203],[152,173,192],[162,172,181],[172,170,171],[182,168,163],[193,165,155],[203,162,147],[212,158,140],[221,155,132],[230,151,124],[238,148,116],[246,144,108]],
  CET_D12: [[0,200,255],[57,198,246],[92,196,237],[115,194,228],[133,192,219],[149,190,210],[162,188,202],[174,186,193],[184,184,187],[191,181,189],[198,178,195],[205,175,200],[212,172,206],[218,169,211],[224,166,216],[231,162,222],[237,158,227]],
  CET_D13: [[16,44,103],[32,65,138],[46,87,171],[54,112,202],[50,140,228],[66,169,245],[120,195,251],[182,217,247],[223,235,236],[174,223,208],[108,205,176],[56,182,138],[36,157,95],[31,130,59],[21,105,33],[8,81,15],[0,57,1]],
  CET_R1: [[0,47,245],[25,94,190],[38,122,138],[62,143,89],[71,163,36],[114,177,16],[160,188,23],[204,198,30],[241,202,36],[249,185,33],[248,159,28],[244,133,23],[240,105,20],[241,85,47],[251,101,110],[255,123,178],[253,145,250]],
  CET_R2: [[0,51,245],[0,88,200],[0,114,157],[49,131,118],[62,148,77],[66,164,26],[106,175,17],[145,184,25],[180,193,32],[213,200,39],[245,204,44],[253,186,37],[255,164,28],[255,141,19],[255,116,10],[254,87,2],[252,48,0]],
  CET_R3: [[8,92,248],[22,124,187],[49,146,121],[63,164,49],[103,175,29],[142,184,26],[177,193,21],[212,201,15],[244,204,31],[252,185,74],[254,161,105],[254,136,131],[252,107,154],[248,76,166],[241,54,119],[229,34,66],[214,4,0]],
  CET_R4: [[3,0,108],[5,0,156],[11,24,193],[16,48,224],[29,79,234],[5,124,169],[47,154,79],[81,177,8],[137,193,4],[184,208,2],[230,222,1],[250,204,11],[251,171,19],[252,135,20],[254,91,15],[244,38,12],[214,5,13]],
  CET_I1: [[54,183,236],[63,184,222],[71,185,207],[79,186,193],[87,186,178],[96,187,163],[106,186,147],[119,186,131],[135,184,117],[151,181,107],[167,177,100],[183,172,95],[197,167,93],[211,162,94],[224,156,97],[235,150,102],[246,144,108]],
  CET_I2: [[111,209,255],[112,210,245],[114,212,232],[117,213,219],[120,214,205],[125,214,191],[132,214,177],[142,214,162],[156,212,148],[170,210,137],[186,206,129],[202,202,122],[216,198,118],[230,193,117],[242,188,119],[254,183,123],[255,178,129]],
  CET_I3: [[19,185,229],[62,183,231],[85,180,233],[104,177,235],[121,174,235],[136,171,236],[151,168,235],[165,164,233],[178,161,228],[190,157,223],[201,154,216],[211,151,210],[221,147,202],[230,143,195],[238,140,188],[246,136,180],[253,132,172]],
  CET_C1: [[248,132,247],[249,104,196],[234,67,136],[207,36,75],[181,26,21],[189,67,4],[204,105,4],[213,143,4],[207,170,39],[164,160,95],[94,140,144],[33,108,193],[59,63,238],[104,76,249],[146,106,250],[202,124,254],[247,133,249]],
  CET_C2: [[239,85,241],[251,132,206],[251,175,161],[252,212,113],[240,237,53],[198,229,22],[150,211,16],[97,193,11],[49,172,40],[66,145,96],[62,115,151],[41,80,197],[43,36,232],[96,34,245],[142,56,250],[193,67,250],[237,82,243]],
  CET_C3: [[224,215,218],[237,187,173],[239,147,122],[235,104,73],[218,61,33],[173,50,26],[123,45,28],[76,38,28],[41,33,38],[42,46,78],[48,66,134],[42,87,194],[47,110,245],[111,136,250],[157,165,243],[194,195,235],[223,215,220]],
  CET_C4: [[222,213,216],[230,181,167],[225,136,112],[213,88,59],[201,48,22],[212,85,57],[224,133,109],[230,179,165],[220,209,215],[187,188,228],[145,153,229],[91,119,229],[25,99,228],[92,120,229],[146,153,229],[188,189,228],[221,213,218]],
  CET_C5: [[119,119,119],[141,141,141],[163,163,163],[187,187,187],[202,202,202],[185,185,185],[162,162,162],[139,139,139],[117,117,117],[97,97,97],[77,77,77],[57,57,57],[45,45,45],[57,57,57],[76,76,76],[97,97,97],[118,118,118]],
  CET_C6: [[246,54,26],[252,116,1],[255,179,0],[225,209,0],[152,184,0],[76,155,18],[43,167,81],[49,206,161],[37,232,234],[48,200,255],[40,150,255],[88,129,255],[170,158,255],[234,189,251],[255,165,185],[255,104,99],[246,53,29]],
  CET_C7: [[232,228,25],[250,197,104],[255,157,157],[255,111,204],[251,62,246],[227,122,254],[195,172,253],[147,213,252],[59,243,242],[46,230,195],[51,209,141],[39,189,86],[35,174,24],[97,186,0],[146,203,0],[191,218,0],[231,228,18]],
  CET_C8: [[232,148,149],[239,166,131],[237,185,115],[228,205,101],[204,221,99],[167,221,123],[134,212,149],[98,201,172],[61,187,193],[24,174,209],[6,158,222],[42,141,231],[97,124,231],[155,119,213],[190,123,191],[215,132,170],[232,146,150]],
  CET_C9: [[194,127,116],[205,157,108],[209,187,101],[205,218,97],[182,239,105],[144,230,129],[112,208,148],[81,183,163],[52,158,172],[27,133,178],[7,107,179],[21,80,177],[67,55,168],[117,53,152],[150,72,138],[175,97,127],[193,125,117]],
  CET_C10: [[217,144,132],[207,150,118],[190,157,110],[171,164,108],[148,170,115],[125,174,131],[102,177,151],[79,178,173],[65,177,193],[81,174,207],[111,168,214],[141,162,216],[170,154,210],[193,148,195],[208,144,175],[217,142,154],[217,144,133]],
  CET_C11: [[71,48,241],[95,86,203],[106,124,158],[94,160,109],[72,183,52],[114,161,17],[145,124,4],[164,80,0],[180,21,17],[203,17,64],[227,52,122],[246,79,184],[250,98,241],[217,86,254],[173,67,253],[123,50,251],[72,47,242]],
  CET_CBL1: [[16,16,16],[19,28,47],[13,40,76],[0,52,103],[1,65,125],[31,77,140],[66,91,140],[97,104,129],[121,118,118],[142,132,106],[163,146,92],[182,161,89],[198,176,103],[212,191,128],[224,207,160],[234,223,197],[240,240,240]],
  CET_CBL2: [[16,16,16],[22,28,44],[20,41,73],[16,53,100],[15,66,125],[14,80,150],[11,94,175],[6,108,202],[0,123,228],[54,136,241],[126,151,211],[172,167,161],[204,182,112],[229,198,56],[248,214,56],[255,231,158],[251,249,243]],
  CET_CBL3: [[16,16,16],[25,28,38],[30,40,61],[35,52,85],[37,64,110],[37,77,136],[35,91,163],[28,105,192],[12,119,220],[24,132,242],[77,147,250],[116,161,249],[146,176,248],[172,192,246],[196,208,244],[219,224,242],[240,240,240]],
  CET_CBL4: [[16,16,16],[33,28,14],[47,40,10],[61,52,5],[76,64,1],[91,77,1],[106,90,1],[122,104,1],[138,118,1],[154,131,1],[171,146,1],[188,161,1],[205,176,1],[223,191,0],[241,207,16],[254,222,99],[244,240,231]],
  CET_CBD1: [[58,144,254],[97,155,252],[125,166,251],[148,178,250],[168,190,248],[188,202,246],[206,215,244],[223,227,242],[237,236,236],[233,227,212],[226,214,185],[218,202,159],[209,190,132],[200,178,106],[189,166,79],[179,154,50],[167,143,8]],
  CET_CBD2: [[4,136,252],[69,141,243],[97,146,234],[116,151,225],[132,157,216],[146,162,206],[158,167,197],[169,173,188],[179,179,178],[190,184,169],[200,189,159],[210,194,149],[220,199,138],[229,205,127],[238,210,115],[246,216,103],[254,221,89]],
  CET_CBC1: [[62,134,234],[118,159,240],[164,185,242],[204,213,243],[235,233,233],[223,211,181],[203,184,127],[180,157,72],[154,132,17],[127,109,24],[98,85,33],[70,62,38],[47,46,46],[52,62,86],[59,84,134],[59,108,185],[59,133,232]],
  CET_CBC2: [[238,237,236],[226,214,183],[206,186,126],[182,159,67],[162,139,1],[181,158,64],[205,185,123],[225,213,181],[235,234,235],[204,214,245],[162,186,247],[112,159,248],[54,140,248],[113,159,248],[163,186,247],[205,214,245],[237,237,238]],
  CET_CBTL1: [[16,16,16],[52,18,14],[85,12,12],[114,1,14],[139,2,19],[163,5,26],[189,11,32],[215,17,39],[241,28,46],[251,67,67],[231,119,112],[188,161,166],[111,195,219],[41,218,250],[132,230,252],[196,239,251],[249,249,249]],
  CET_CBTL2: [[16,16,16],[47,21,17],[73,24,21],[95,30,26],[115,40,35],[127,56,49],[130,77,70],[127,98,94],[119,119,121],[105,138,147],[77,158,176],[26,177,204],[29,194,223],[84,208,234],[137,221,241],[189,231,242],[240,240,240]],
  CET_CBTL3: [[16,16,16],[23,29,31],[27,42,46],[31,56,62],[33,70,78],[35,84,95],[36,99,112],[36,114,130],[35,130,148],[34,145,166],[31,161,185],[29,177,203],[31,194,222],[47,210,240],[109,224,249],[175,234,249],[240,240,240]],
  CET_CBTL4: [[16,16,16],[46,22,18],[73,24,20],[100,25,23],[127,24,25],[154,23,29],[180,24,34],[205,31,41],[227,45,50],[242,67,64],[248,97,86],[252,124,110],[254,148,135],[254,172,160],[252,195,186],[247,218,213],[240,240,240]],
  CET_CBTD1: [[41,201,230],[89,207,233],[120,213,235],[145,219,237],[168,225,240],[190,231,242],[210,237,244],[229,243,246],[247,246,246],[251,237,235],[253,226,222],[254,215,210],[254,204,197],[255,193,184],[254,182,172],[253,171,160],[252,160,148]],
  CET_CBTC1: [[38,187,214],[110,204,226],[163,220,235],[209,237,245],[248,247,248],[253,225,221],[250,198,191],[244,172,162],[233,147,136],[202,134,125],[167,121,114],[132,108,104],[100,99,100],[92,117,124],[83,140,154],[64,163,184],[35,186,213]],
  CET_CBTC2: [[251,250,250],[254,228,224],[252,201,193],[247,175,164],[243,154,142],[247,173,163],[252,200,192],[254,227,222],[248,248,249],[210,238,246],[163,222,237],[108,206,228],[43,194,222],[109,206,228],[164,222,237],[211,238,246],[249,250,250]],
  // cmocean.phase — cyclic perceptually-uniform colormap by Thyng et al. 2016.
  // https://matplotlib.org/cmocean/#phase
  cmo_phase: [[168,120,13],[190,104,40],[207,86,67],[219,64,102],[223,42,147],[213,41,196],[192,65,229],[162,92,243],[125,115,240],[82,133,220],[44,144,188],[25,149,156],[12,152,124],[36,154,82],[94,148,32],[139,134,13],[168,120,13]],
};

// Class metadata for the dropdown <optgroup>s.
// `label` is a literal (cmocean — a proper noun, not translated); every other
// group carries a labelKey routed through STRINGS/t() (see rebuildColormapOptions).
const COLORCET_GROUPS = [
  { label: "cmocean", keys: ["cmo_phase"] },
  { labelKey: "cmap.grp.linear", keys: ["CET_L1","CET_L2","CET_L3","CET_L4","CET_L5","CET_L6","CET_L7","CET_L8","CET_L9","CET_L10","CET_L11","CET_L12","CET_L13","CET_L14","CET_L15","CET_L16","CET_L17","CET_L18","CET_L19","CET_L20"] },
  { labelKey: "cmap.grp.diverging", keys: ["CET_D1","CET_D1A","CET_D2","CET_D3","CET_D4","CET_D6","CET_D7","CET_D8","CET_D9","CET_D10","CET_D11","CET_D12","CET_D13"] },
  { labelKey: "cmap.grp.rainbow", keys: ["CET_R1","CET_R2","CET_R3","CET_R4"] },
  { labelKey: "cmap.grp.isoluminant", keys: ["CET_I1","CET_I2","CET_I3"] },
  { labelKey: "cmap.grp.cyclic", keys: ["CET_C1","CET_C2","CET_C3","CET_C4","CET_C5","CET_C6","CET_C7","CET_C8","CET_C9","CET_C10","CET_C11"] },
  { labelKey: "cmap.grp.cb_linear", keys: ["CET_CBL1","CET_CBL2","CET_CBL3","CET_CBL4"] },
  { labelKey: "cmap.grp.cb_diverging", keys: ["CET_CBD1","CET_CBD2"] },
  { labelKey: "cmap.grp.cb_cyclic", keys: ["CET_CBC1","CET_CBC2"] },
  { labelKey: "cmap.grp.tritan_linear", keys: ["CET_CBTL1","CET_CBTL2","CET_CBTL3","CET_CBTL4"] },
  { labelKey: "cmap.grp.tritan_diverging", keys: ["CET_CBTD1"] },
  { labelKey: "cmap.grp.tritan_cyclic", keys: ["CET_CBTC1","CET_CBTC2"] },
];

// Rebuild a colormap <select>'s <optgroup>s in place, preserving the current
// selection — shared by the two dropdown populators below AND by a language
// toggle (see refreshColormapLabels), since optgroup labels are DOM properties
// set at build time, not data-i18n attributes applyTranslations can reach.
function rebuildColormapOptions(sel) {
  const prevValue = sel.value;
  sel.innerHTML = "";
  for (const grp of COLORCET_GROUPS) {
    const og = document.createElement("optgroup");
    og.label = grp.labelKey ? t(grp.labelKey) : grp.label;
    for (const k of grp.keys) {
      if (!COLORMAPS[k]) continue;
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = k === "cmo_phase" ? "cmocean.phase" : k.replace("CET_", "CET-");
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  if (prevValue) sel.value = prevValue;
}

let activeColormap = "cmo_phase"; // cmocean.phase — cyclic, perceptually uniform

// Sample a CET colormap at evenly-spaced positions for top-N route colours.
// route i of n → t = (i + 0.5) / n so we land in the middle of each band
// rather than at the saturated endpoints.
function routeColour(i, n) {
  const name = document.getElementById("routes-colormap")?.value || "CET_R2";
  const anchors = COLORMAPS[name] || COLORMAPS.CET_R2;
  const t = n > 1 ? (i + 0.5) / n : 0.5;
  const m = anchors.length - 1;
  const f = t * m;
  const j = Math.floor(f);
  const frac = f - j;
  const a = anchors[Math.min(j, m)];
  const b = anchors[Math.min(j + 1, m)];
  const r = Math.round(a[0] + (b[0] - a[0]) * frac);
  const g = Math.round(a[1] + (b[1] - a[1]) * frac);
  const bl = Math.round(a[2] + (b[2] - a[2]) * frac);
  return `rgb(${r},${g},${bl})`;
}

// Recolour the existing top-N route polylines in place from the current
// routes-colormap. Cheap setStyle on the already-drawn lines — no recompute
// and no energy/passes raster re-render (the maximize path is a fixed colour,
// unaffected). Used by the routes-colormap selector, which previously called
// the full rerenderCachedResult() and re-rasterised both W×H field canvases.
function recolorRouteLines() {
  if (!state.routeLines || !state.routeLines.length) return;
  const n = state.routeLines.length;
  for (let i = 0; i < n; i++) state.routeLines[i].setStyle({ color: routeColour(i, n) });
}

function colormap(t) {
  const anchors = COLORMAPS[activeColormap] || COLORMAPS.cmo_phase;
  t = Math.max(0, Math.min(1, t));
  const n = anchors.length - 1;
  const f = t * n;
  const i = Math.floor(f);
  const frac = f - i;
  const a = anchors[Math.min(i, n)];
  const b = anchors[Math.min(i + 1, n)];
  return [
    Math.round(a[0] + (b[0] - a[0]) * frac),
    Math.round(a[1] + (b[1] - a[1]) * frac),
    Math.round(a[2] + (b[2] - a[2]) * frac),
  ];
}

// Build a CSS linear-gradient string for the swatch.
function colormapToCss(name) {
  const anchors = COLORMAPS[name];
  const stops = anchors.map((rgb, i) => {
    const pct = ((i / (anchors.length - 1)) * 100).toFixed(1);
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]}) ${pct}%`;
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

function applyColormapToLegend() {
  const swatch = document.querySelector(".swatch");
  if (swatch) swatch.style.background = colormapToCss(activeColormap);
}

// ------- Bundle download / reload -------
// `metadata.jsonld` captures everything needed to reproduce the run from the
// same DEM: timestamps, engine, all compute parameters, source/destination
// pixel coordinates, and the visualisation knobs. Output rasters are written
// as GeoTIFFs (energy.tif / passes.tif / network.tif) so they drop straight
// into QGIS without needing the metadata to interpret them. Routes and the
// path are GeoJSON. JSON-LD `@context` is inlined so the file is self-
// describing without a network fetch.

// ---- GeoTIFF helpers --------------------------------------------------------
// We use geotiff.js's writer (bundled in the same script as the reader). The
// metadata schema mirrors what readRasters expects on the way back, so the
// round-trip is lossless. Float32 / Float64 / Uint8 cover all our outputs.

function tiffMetadataForDem(dem, sampleKind) {
  // sampleKind: "float32" (energy), "float64" (passes), or "uint8" (mask).
  const { H, W, originX, originY, dx, dy, isGeographic, geoKeys } = dem;
  const bps = sampleKind === "float64" ? 64 : sampleKind === "uint8" ? 8 : 32;
  // SampleFormat: 1 = unsigned int, 2 = signed int, 3 = IEEE floating point.
  const sf  = sampleKind === "uint8" ? 1 : 3;
  const md = {
    width:  W,
    height: H,
    BitsPerSample: [bps],
    SampleFormat:  [sf],
    SamplesPerPixel: [1],
    // ModelTiepoint maps raster pixel (0,0,0) to world (originX, originY, 0).
    // ModelPixelScale gives the per-pixel size; dy is positive in our DEM
    // model (height per row going down) so we use it directly.
    ModelTiepoint:    [0, 0, 0, originX, originY, 0],
    ModelPixelScale:  [Math.abs(dx), Math.abs(dy), 0],
  };
  // Forward the source DEM's CRS info verbatim. If we don't have it (older
  // load path) but we know the DEM is geographic, set EPSG:4326. The writer
  // also defaults to 4326 if neither is set, so projected DEMs without
  // captured GeoKeys would be misinterpreted — this is the failure mode to
  // watch for.
  if (geoKeys && Object.keys(geoKeys).length > 0) {
    Object.assign(md, geoKeys);
  } else if (isGeographic) {
    md.GeographicTypeGeoKey = 4326;
  }
  // Backfill the mandatory GTModelTypeGeoKey/GTRasterTypeGeoKey when the
  // source (or the branch above) didn't provide them — GDAL/QGIS otherwise
  // read the GeoKeyDirectory as an unknown engineering CRS instead of the
  // intended geographic/projected one. Never override a source-provided key.
  if (md.ProjectedCSTypeGeoKey && md.GTModelTypeGeoKey == null) {
    md.GTModelTypeGeoKey = 1;
  } else if (md.GeographicTypeGeoKey && md.GTModelTypeGeoKey == null) {
    md.GTModelTypeGeoKey = 2;
  }
  if (md.GTModelTypeGeoKey != null && md.GTRasterTypeGeoKey == null) {
    md.GTRasterTypeGeoKey = 1;
  }
  return md;
}

function writeRasterAsGeoTIFF(values, dem, sampleKind, extraMd) {
  if (typeof GeoTIFF?.writeArrayBuffer !== "function") {
    throw new Error("GeoTIFF writer unavailable — load the full geotiff.js bundle.");
  }
  const md = tiffMetadataForDem(dem, sampleKind);
  // extraMd is opt-in per call (e.g. exportDemTif's GDAL_NODATA) — never
  // folded into tiffMetadataForDem itself, so energy/passes/network/
  // impassable exports don't inherit the source DEM's elevation sentinel.
  if (extraMd) Object.assign(md, extraMd);
  return GeoTIFF.writeArrayBuffer(values, md);
}

// Read a GeoTIFF blob from a bundle and return the underlying typed array
// in the requested element kind. We do a strict size check against the
// loaded DEM dims so a v3 bundle restored against a wrong DEM fails loudly
// (the buffer length mismatch surfaces the same way the .bin path does).
// NOTE: loadBundleFile's zip-entry size cap only bounds the ZIP-layer
// decompressed size — a small-but-valid GeoTIFF using its own internal
// compression (LZW/Deflate strips) could still expand to a large in-memory
// raster inside readRasters() below, past that cap. Not guarded here; a
// tighter check would compare image.getWidth()*getHeight()*bytesPerSample
// against the same cap right after tiff.getImage(), before readRasters().
async function readRasterFromGeoTIFF(arrayBuffer, expectedKind) {
  const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();
  const raster = await image.readRasters({ interleave: true });
  // readRasters returns the typed-array kind that matches the file's
  // BitsPerSample/SampleFormat. We coerce to the kind the caller wants.
  if (expectedKind === "float32" && !(raster instanceof Float32Array)) {
    return Float32Array.from(raster);
  }
  if (expectedKind === "float64" && !(raster instanceof Float64Array)) {
    return Float64Array.from(raster);
  }
  if (expectedKind === "uint8" && !(raster instanceof Uint8Array)) {
    return Uint8Array.from(raster);
  }
  return raster;
}

// ===================== Impassable mask + bridge corridors =====================
// An optional binary raster ("water") marks cells impassable. It is resampled
// onto the DEM grid by AREA-COVERAGE MAJORITY (a DEM cell is impassable iff
// ≥50% of its footprint is impassable in the source). The loaded vector network
// can OPTIONALLY carve passable "bridge" corridors across the mask: each
// corridor cell is levelled to a smooth profile — land elevation at each shore
// entrance, a linear ramp up to (+/-offset) at the bridge centre, then back
// down. Everything is composed in buildComputeGrid() *before* the grid reaches
// the worker/backend, so the engines are unchanged AND a run with no/all-zero
// mask is byte-identical to before (see buildComputeGrid).

function geoKeysToEpsg(gk) {
  if (!gk) return null;
  return gk.ProjectedCSTypeGeoKey || gk.ProjectedCRSGeoKey ||
         gk.GeographicTypeGeoKey || gk.GeodeticCRSGeoKey || null;
}

// Resolve a proj4 source key for an EPSG code, registering WGS84/UTM defs
// formulaically (proj4 only ships 4326 + a handful). Returns "EPSG:4326" for
// geographic codes, a registered "EPSG:<code>" for WGS84/UTM, or null if the
// code is projected-but-unknown (caller then assumes DEM-aligned coords).
function proj4DefForEpsg(code) {
  if (!code || code === 4326 || code === 4269 || code === 4979) return "EPSG:4326";
  const key = `EPSG:${code}`;
  try { if (proj4.defs(key)) return key; } catch {}
  if (code >= 32601 && code <= 32660) {
    proj4.defs(key, `+proj=utm +zone=${code - 32600} +datum=WGS84 +units=m +no_defs`);
    return key;
  }
  if (code >= 32701 && code <= 32760) {
    proj4.defs(key, `+proj=utm +zone=${code - 32700} +south +datum=WGS84 +units=m +no_defs`);
    return key;
  }
  return null;
}

// Parse an uploaded mask GeoTIFF → { width, height, data, dx, dy, originX,
// originY, epsg }. dx/dy are positive (pixel size); originX/Y is the top-left.
async function readMaskGeoTIFF(arrayBuffer) {
  const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const tiePoints = await image.getTiePoints();
  const scale = image.fileDirectory.getValue("ModelPixelScale");
  if (!scale || !tiePoints?.length) {
    throw new Error(t("status.mask_no_geotransform"));
  }
  // samples: [0] selects band 0 explicitly — without it, a multi-band mask
  // GeoTIFF would be read pixel-interleaved and misread the same way a
  // multi-band DEM would (see loadDemFromArrayBuffer).
  const data = await image.readRasters({ samples: [0], interleave: true });
  let geoKeys = null;
  try { geoKeys = image.getGeoKeys ? image.getGeoKeys() : null; } catch {}
  return {
    width, height, data,
    dx: Math.abs(scale[0]), dy: Math.abs(scale[1]),
    originX: tiePoints[0].x, originY: tiePoints[0].y,
    epsg: geoKeysToEpsg(geoKeys),
  };
}

// Resample a parsed mask raster onto the DEM grid → Uint8Array (1=impassable),
// area-coverage majority (≥50%) via adaptive S×S sub-sampling of each DEM cell.
// Sub-points outside the source extent count as PASSABLE (the "missing = passable"
// rule). Only meaningful for geographic DEMs (the rest of the app is gated the
// same way). `invert` flips the source convention (uploaded raster marks passable).
function resampleMaskToDem(raster, dem, opts = {}) {
  const invert = !!opts.invert;
  const { H, W, originX, originY, dx, dy, isGeographic } = dem;
  const out = new Uint8Array(W * H); // 0 = passable
  // Nearest-pixel sub-point sampler: value>0 (xor invert) → impassable.
  const sample = (mx, my) => {
    const mc = Math.floor((mx - raster.originX) / raster.dx);
    const mr = Math.floor((raster.originY - my) / raster.dy);
    if (mc < 0 || mc >= raster.width || mr < 0 || mr >= raster.height) return 0; // missing = passable
    const v = raster.data[mr * raster.width + mc] > 0;
    return (v !== invert) ? 1 : 0;
  };
  // CRS: DEM is lon/lat (4326) when geographic. Reproject DEM sub-points into
  // the mask CRS only when it differs and we can build a def; otherwise assume
  // the mask shares the DEM's coordinate space (fail-safe: surfaces as a 0-cell
  // result in imp-meta if it doesn't).
  const demKey = isGeographic ? "EPSG:4326" : proj4DefForEpsg(geoKeysToEpsg(dem.geoKeys));
  const maskKey = proj4DefForEpsg(raster.epsg);
  const reproject = (demKey && maskKey && demKey !== maskKey)
    ? (x, y) => proj4(demKey, maskKey, [x, y]) : null;
  // Sub-samples per axis ≈ source pixels spanned by a DEM cell, capped at 8.
  // A finer source is area-averaged; an equal/coarser source collapses to S=1
  // (a single centre sample — correct, one source pixel spans the DEM cell).
  const S = reproject ? 4 : Math.max(1, Math.min(8, Math.ceil(dx / raster.dx)));
  const S2 = S * S;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      let hit = 0;
      for (let j = 0; j < S; j++) {
        const y = originY - (r + (j + 0.5) / S) * dy;
        for (let i = 0; i < S; i++) {
          const x = originX + (c + (i + 0.5) / S) * dx;
          if (reproject) { const p = reproject(x, y); hit += sample(p[0], p[1]); }
          else hit += sample(x, y);
        }
      }
      out[r * W + c] = (hit * 2 >= S2) ? 1 : 0; // ≥50% coverage → impassable
    }
  }
  return out;
}

// The corridor elevation offset, clamped to the supported bridge range.
function corridorOffsetMetres() {
  const v = parseFloat(document.getElementById("imp-offset")?.value);
  if (!Number.isFinite(v)) return 0;
  return Math.max(-5, Math.min(15, v));
}

// Local-graph Dijkstra (binary heap) from a set of seed nodes; edge weights in
// metres. Returns a Float64Array of geodesic distances (Infinity if unreached —
// e.g. cells in a different corridor component). m = node count.
function dijkstraLocal(seeds, nbr, nbrLen, m) {
  const dist = new Float64Array(m).fill(Infinity);
  const heap = []; // [dist, node]
  const push = (d, n) => {
    heap.push([d, n]); let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last; let i = 0;
      for (;;) {
        let l = 2 * i + 1, rr = 2 * i + 2, s = i;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (rr < heap.length && heap[rr][0] < heap[s][0]) s = rr;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]]; i = s;
      }
    }
    return top;
  };
  for (const s of seeds) if (dist[s] !== 0) { dist[s] = 0; push(0, s); }
  while (heap.length) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    const ns = nbr[u], ls = nbrLen[u];
    for (let k = 0; k < ns.length; k++) {
      const v = ns[k], nd = d + ls[k];
      if (nd < dist[v]) { dist[v] = nd; push(nd, v); }
    }
  }
  return dist;
}

// Recompute the cached bridge corridors (network ∩ impassable cells, reopened
// and levelled). Runs only on mask/network/corridor-toggle change — cheap, and
// keeps buildComputeGrid() a pure apply. Per connected corridor component:
//   • shore "entrances" = corridor cells touching a valid land-network cell,
//     grouped into clusters (the two bridge ends);
//   • base elevation = linear interpolation between the two ends (t along the
//     bridge); 1 end → flat; ≥3 ends → inverse-distance blend (rare junctions);
//   • ramp = geodesic distance to the nearest entrance ÷ its component max
//     (0 at the entrances, 1 at the centre) — the offset is scaled by this, so
//     height = base + offset·ramp gives a smooth ramp up to the bridge centre.
// Components with no land entrance are left blocked (can't bridge to nowhere).
function recomputeCorridors() {
  state.corridorCells = null; state.corridorBase = null; state.corridorRamp = null;
  state.corridorSet = null;
  const dem = state.dem, imp = state.impassable, net = state.networkMask;
  const on = !!document.getElementById("imp-corridor")?.checked;
  if (!dem || !imp || !net || !on) return;
  const { H, W, dxM, dyM, height, mask: dmask } = dem;
  const N = H * W;
  // 1) corridor cells (network ∩ impassable) + global→local index map.
  const cells = []; const local = new Map();
  for (let i = 0; i < N; i++) if (net[i] && imp[i]) { local.set(i, cells.length); cells.push(i); }
  const m = cells.length;
  if (!m) return;
  const drs = [-1, -1, -1, 0, 0, 1, 1, 1], dcs = [-1, 0, 1, -1, 1, -1, 0, 1];
  const diag = Math.hypot(dxM, dyM);
  const stepLen = [diag, dyM, diag, dxM, dxM, diag, dyM, diag];
  // 2) local adjacency among corridor cells + summed adjacent land elevations.
  const nbr = new Array(m), nbrLen = new Array(m);
  const entElev = new Float64Array(m), entCnt = new Int32Array(m);
  for (let li = 0; li < m; li++) {
    const i = cells[li]; const r = (i / W) | 0, c = i - r * W;
    const ns = [], ls = [];
    for (let k = 0; k < 8; k++) {
      const nr = r + drs[k], nc = c + dcs[k];
      if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
      const j = nr * W + nc;
      const lj = local.get(j);
      if (lj !== undefined) { ns.push(lj); ls.push(stepLen[k]); }
      else if (net[j] && !imp[j] && dmask[j]) { entElev[li] += height[j]; entCnt[li]++; }
    }
    nbr[li] = ns; nbrLen[li] = ls;
  }
  // 3) connected components over the corridor graph.
  const comp = new Int32Array(m).fill(-1); let nComp = 0;
  for (let li = 0; li < m; li++) {
    if (comp[li] >= 0) continue;
    const cid = nComp++; const q = [li]; comp[li] = cid;
    while (q.length) { const x = q.pop(); for (const y of nbr[x]) if (comp[y] < 0) { comp[y] = cid; q.push(y); } }
  }
  // 4) entrance clusters (8-connected entrance cells) — naturally per-component.
  const isEnt = new Uint8Array(m);
  for (let li = 0; li < m; li++) if (entCnt[li] > 0) isEnt[li] = 1;
  const clusterId = new Int32Array(m).fill(-1);
  const clusters = []; const clustersByComp = Array.from({ length: nComp }, () => []);
  for (let li = 0; li < m; li++) {
    if (!isEnt[li] || clusterId[li] >= 0) continue;
    const cid = clusters.length; const q = [li]; clusterId[li] = cid;
    const cc = []; let esum = 0, ecnt = 0;
    while (q.length) {
      const x = q.pop(); cc.push(x); esum += entElev[x]; ecnt += entCnt[x];
      for (const y of nbr[x]) if (isEnt[y] && clusterId[y] < 0) { clusterId[y] = cid; q.push(y); }
    }
    clusters.push({ cells: cc, elev: ecnt ? esum / ecnt : 0, comp: comp[li] });
    clustersByComp[comp[li]].push(cid);
  }
  // 5) per-cluster geodesic distance + nearest-entrance distance for the ramp.
  const distOf = clusters.map((cl) => dijkstraLocal(cl.cells, nbr, nbrLen, m));
  const dNear = new Float64Array(m).fill(Infinity);
  for (const d of distOf) for (let li = 0; li < m; li++) if (d[li] < dNear[li]) dNear[li] = d[li];
  const compMaxNear = new Float64Array(nComp);
  for (let li = 0; li < m; li++) { const cm = comp[li]; if (Number.isFinite(dNear[li]) && dNear[li] > compMaxNear[cm]) compMaxNear[cm] = dNear[li]; }
  // 6) base + ramp per corridor cell; drop cells whose component has no shore.
  const outCells = [], outBase = [], outRamp = [];
  for (let li = 0; li < m; li++) {
    const cl = clustersByComp[comp[li]];
    if (!cl.length) continue; // no entrance reachable → leave blocked
    let base;
    if (cl.length === 2) {
      const dA = distOf[cl[0]][li], dB = distOf[cl[1]][li];
      const t = (dA + dB) > 0 ? dA / (dA + dB) : 0.5;
      base = (1 - t) * clusters[cl[0]].elev + t * clusters[cl[1]].elev;
    } else if (cl.length === 1) {
      base = clusters[cl[0]].elev;
    } else {
      let num = 0, den = 0;
      for (const ci of cl) {
        const d = distOf[ci][li];
        if (d <= 1e-9) { num = clusters[ci].elev; den = 1; break; }
        const w = 1 / d; num += w * clusters[ci].elev; den += w;
      }
      base = den ? num / den : clusters[cl[0]].elev;
    }
    const mx = compMaxNear[comp[li]];
    outCells.push(cells[li]);
    outBase.push(base);
    outRamp.push(mx > 0 && Number.isFinite(dNear[li]) ? dNear[li] / mx : 0);
  }
  if (!outCells.length) return;
  state.corridorCells = Int32Array.from(outCells);
  state.corridorBase = Float32Array.from(outBase);
  state.corridorRamp = Float32Array.from(outRamp);
  state.corridorSet = new Set(outCells);
}

// Per-feature "apply to compute" master toggles (1c/1d). When off, the data
// stays loaded (and its overlay can still be shown) but it does NOT affect the
// compute. Default true when the control is absent.
function impassableEnabled() { return document.getElementById("imp-enabled")?.checked ?? true; }
function bridgesEnabled() { return document.getElementById("bridge-enabled")?.checked ?? true; }

// True if a cell is traversable in the EFFECTIVE compute grid (raw DEM mask AND
// not impassable-unless-reopened-as-a-corridor). Used to validate point picks so
// clicks/refs can't land on blocked water that the compute would silently drop.
function effectivePassableAt(idx) {
  if (!state.dem || !state.dem.mask[idx]) return false;
  // Drawn geometry: a passable corridor wins; a barrier blocks (mirrors buildComputeGrid).
  if (state.drawnPassableMask && state.drawnPassableMask[idx]) return true;
  if (state.drawnImpassableMask && state.drawnImpassableMask[idx]) return false;
  if (state.impassable && impassableEnabled() && state.impassable[idx]) {
    return !!(state.corridorSet && state.corridorSet.has(idx));
  }
  return true;
}

// THE single source of truth for the compute grid. Returns fresh, transferable
// height+mask with the impassable mask blocked and bridge corridors reopened +
// levelled. When state.impassable is null OR has no impassable cells (so
// recomputeCorridors produced no corridors), this returns byte-identical copies
// of state.dem.height/mask — guaranteeing prior results are reproduced exactly.
// Must be used by EVERY compute serialization site (worker, density pool,
// backend Blob, compare-secondary, graph build, probe) — there is no single
// dispatch choke point.
function buildComputeGrid(opts = {}) {
  const maskOnly = !!opts.maskOnly; // for the IDW interp DOMAIN (no height needed)
  const dem = state.dem;
  const height = maskOnly ? null : new Float32Array(dem.height);
  const mask = new Uint8Array(dem.mask);
  const imp = impassableEnabled() ? state.impassable : null; // 1c master toggle
  if (imp) {
    const N = mask.length;
    for (let i = 0; i < N; i++) if (imp[i] && mask[i]) mask[i] = 0; // block water on valid land
    const cells = state.corridorCells;
    if (cells && cells.length) {
      const off = maskOnly ? 0 : corridorOffsetMetres();
      const base = state.corridorBase, ramp = state.corridorRamp;
      for (let k = 0; k < cells.length; k++) {
        const i = cells[k];
        mask[i] = 1;                                  // reopen the corridor (even over nodata water)
        if (!maskOnly) height[i] = base[k] + off * ramp[k]; // smooth bridge profile
      }
    }
  }
  // Drawn geometry (1C): barriers block valid cells; passable corridors reopen
  // them (override). Applied AFTER the file/OSM mask so a drawn corridor wins.
  const dImp = state.drawnImpassableMask, dPass = state.drawnPassableMask;
  if (dImp || dPass) {
    const N = mask.length;
    for (let i = 0; i < N; i++) {
      if (!dem.mask[i]) continue;                     // never touch true nodata
      if (dImp && dImp[i]) mask[i] = 0;
      if (dPass && dPass[i]) mask[i] = 1;
    }
  }
  return maskOnly
    ? { mask, transfer: [mask.buffer] }
    : { height, mask, transfer: [height.buffer, mask.buffer] };
}

// Pack the loaded OSM bridges into portal-edge arrays for the engine: end-cell
// indices (u, v) and the deck length in metres. The worker/backend compute the
// directed deck cost from these + the (composed) height array, so JS and Rust
// derive identical costs (parity). Returns null when no bridges are loaded — in
// which case the compute is byte-identical to before (no-op invariant).
function buildPortals() {
  const brs = state.bridges;
  if (!brs || !brs.length || !bridgesEnabled()) return null; // 1d master toggle
  const n = brs.length;
  const u = new Int32Array(n), v = new Int32Array(n), lenM = new Float64Array(n);
  // Deck-END elevations from OSM `ele` (NaN = unmapped → the engine falls back to
  // the DEM at the abutment cell). hu/hv pair with endA/endB.
  const hu = new Float64Array(n), hv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    u[i] = brs[i].endA; v[i] = brs[i].endB; lenM[i] = brs[i].deckLenM;
    hu[i] = (brs[i].eleA != null) ? brs[i].eleA : NaN;
    hv[i] = (brs[i].eleB != null) ? brs[i].eleB : NaN;
  }
  return { u, v, lenM, hu, hv, n };
}

// Grid cells a bridge's deck geometry passes through (Bresenham along its
// polyline), clipped to the DEM. Used to paint deck passes/density.
function bridgeDeckCells(br) {
  const { W, H } = state.dem;
  const pts = br.latlngs.map(([lat, lng]) => llToCell(lat, lng));
  const cells = [];
  for (let i = 1; i < pts.length; i++) {
    let r = pts[i - 1][0], c = pts[i - 1][1];
    const r1 = pts[i][0], c1 = pts[i][1];
    const dr = Math.abs(r1 - r), dc = Math.abs(c1 - c), sr = r < r1 ? 1 : -1, sc = c < c1 ? 1 : -1;
    let err = dc - dr;
    for (;;) {
      if (r >= 0 && r < H && c >= 0 && c < W) cells.push(r * W + c);
      if (r === r1 && c === c1) break;
      const e2 = 2 * err;
      if (e2 > -dr) { err -= dr; c += sc; }
      if (e2 < dc) { err += dc; r += sr; }
    }
  }
  return cells;
}

// A bridge portal jumps abutment→abutment, so the deck's interior cells aren't
// in the path tree and carry no passes. Paint them with the flow crossing the
// bridge so the deck shows up: flow = min(passes[endA], passes[endB]) — which is
// exactly the portal's tree-edge flow (the downstream abutment's subtree) for a
// single source, and a tight estimate for round/density. max() so a deck cell
// with heavier ground traffic underneath isn't lowered. Raster modes only —
// graph mode already routes the (flattened) deck edges, so they carry passes.
function stampBridgeDeckPasses(passes) {
  if (!passes || !state.bridges || !state.dem || !bridgesEnabled()) return;
  const { W, H } = state.dem;
  // The deck is a 1-cell-wide Bresenham line over water (mask=0, unreached by the
  // compute), so it reads faint — and on a big DEM the passes overlay downsamples
  // by `stride`, dropping a 1-cell line between samples → a GAP along the bridge.
  // Dilate the stamp by the render stride (≥1) so the deck always lands on a
  // sampled cell and reads as a continuous line.
  const rad = Math.max(1, overlayCanvasDims(W, H).stride);
  for (const br of state.bridges) {
    const a = passes[br.endA], b = passes[br.endB];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const flow = Math.min(a, b);
    if (!(flow > 0)) continue;
    for (const cell of bridgeDeckCells(br)) {
      const cr = (cell / W) | 0, cc = cell - cr * W;
      for (let dr = -rad; dr <= rad; dr++) {
        const rr = cr + dr; if (rr < 0 || rr >= H) continue;
        const rowOff = rr * W;
        for (let dc = -rad; dc <= rad; dc++) {
          const ccc = cc + dc; if (ccc < 0 || ccc >= W) continue;
          const idx = rowOff + ccc;
          if (flow > passes[idx]) passes[idx] = flow; // max() — don't lower heavier ground traffic
        }
      }
    }
  }
}

// Vocab IRI deliberately points at the actual deployed file rather than an
// abstract namespace. Trade-off: bundles tie themselves to this serving URL,
// but in exchange the @vocab term resolves to a real document instead of a
// 404. If you ever move the deploy, set up a redirect from this URL or bump
// schemaVersion + ship a migration that rewrites the context.
const SIMU_CONTEXT = {
  "@vocab": "https://telhas.pedalhidrografi.co/simujoules/vocab/simujoules.jsonld#",
  "schema": "https://schema.org/",
  "geo": "http://www.opengis.net/ont/geosparql#",
  "qudt": "http://qudt.org/schema/qudt/",
};

function pixelToLonLat(idx, dem) {
  const r = (idx / dem.W) | 0;
  const c = idx - r * dem.W;
  return [dem.originX + (c + 0.5) * dem.dx, dem.originY - (r + 0.5) * dem.dy];
}

// Exact inverse of pixelToLonLat — recover the cell index from a [lon,lat]
// pair. Only safe when the DEM matches the one the coords were written
// against (callers gate on bundleDemMatch(...) === true, below — dims AND
// georeferencing, not just H×W). Used to rebuild the route/path index
// arrays from a bundle's GeoJSON on reload, so restored lines render and
// recolor identically to a fresh compute.
function lonLatToPixel(lon, lat, dem) {
  const c = Math.round((lon - dem.originX) / dem.dx - 0.5);
  const r = Math.round((dem.originY - lat) / dem.dy - 0.5);
  return r * dem.W + c;
}

// Combined dims+georeferencing check for bundle binary replay (rasters,
// routes/path conversion via lonLatToPixel above, src/dst/ref markers,
// network/impassable masks, bridges). Same H×W is NOT enough to prove a
// bundle's DEM is the loaded DEM — many DEM products (e.g. all 1° SRTM/
// FABDEM tiles) share pixel dimensions while covering a different area, so
// a dims-only gate would silently stretch tile-A rasters over tile-B's
// extent. Returns true (safe to replay), false (mismatch — dims OR
// georeferencing differ), or null (unknown: no DEM loaded yet, or mdDem
// lacks dims — old-bundle behaviour is preserved as "unknown", not "false").
function bundleDemMatch(mdDem, dem) {
  if (!dem || !mdDem) return null;
  const { H, W } = mdDem;
  if (!Number.isFinite(H) || !Number.isFinite(W)) return null;
  if (dem.H !== H || dem.W !== W) return false;
  // Dims match — also compare the geotransform when the bundle recorded one
  // (older bundles predate dem.originX/originY/dx/dy — treat as unknown
  // extent there, i.e. dims-only, same as before this check existed).
  const { originX, originY, dx, dy } = mdDem;
  if (![originX, originY, dx, dy].every(Number.isFinite)) return true;
  return (
    Math.abs(originX - dem.originX) <= 0.5 * dem.dx &&
    Math.abs(originY - dem.originY) <= 0.5 * dem.dy &&
    Math.abs(dx - dem.dx) <= 1e-6 * dem.dx &&
    Math.abs(dy - dem.dy) <= 1e-6 * dem.dy
  );
}

// Rebuild a top-N `routes` list ({path, energy, length, shared}) from the
// routes.geojson FeatureCollection a bundle was exported with.
function routesFromFC(fc, dem) {
  if (!fc || !Array.isArray(fc.features)) return null;
  const routes = fc.features
    .filter((f) => f.geometry?.type === "LineString")
    .map((f) => {
      const p = f.properties || {};
      return {
        path:   f.geometry.coordinates.map(([lon, lat]) => lonLatToPixel(lon, lat, dem)),
        energy: p.energy ?? 0,
        length: p.length_m ?? 0,
        shared: p.shared_cells ?? 0,
      };
    });
  // Features are written in rank order (routesFCFromList), so the array is
  // already ordered best-first — no re-sort needed.
  return routes.length ? routes : null;
}

// Rebuild the maximize `path` index array from path.geojson.
function pathFromFC(fc, dem) {
  const feat = fc?.features?.find((f) => f.geometry?.type === "LineString");
  if (!feat) return null;
  return feat.geometry.coordinates.map(([lon, lat]) => lonLatToPixel(lon, lat, dem));
}

// direction documents the relationship between the LineString's coordinate
// order (always written reference/source → destination, in A*-search order)
// and the direction the energy was actually scored in. Mode "to" scores
// destination→reference (energy-worker.js's reverse:true branch), so its
// routes/paths are the one case where coordinate order and travel direction
// disagree — external consumers (QGIS, scripts) reading the geometry in
// coordinate order would otherwise silently attribute the energy to the
// wrong direction.
function routeDirectionLabel(mode) {
  return mode === "to"
    ? "destination→source (energy direction; coordinates written source→destination)"
    : "source→destination";
}

function pathFCFromIndices(path, dem, props = {}, mode) {
  const coords = path.map((i) => pixelToLonLat(i, dem));
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: { ...props, direction: routeDirectionLabel(mode) },
    }],
  };
}

function routesFCFromList(routes, dem, mode) {
  return {
    type: "FeatureCollection",
    features: routes.map((r, i) => ({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: r.path.map((idx) => pixelToLonLat(idx, dem)),
      },
      properties: {
        rank: i + 1,
        energy: r.energy,
        length_m: r.length,
        shared_cells: r.shared,
        direction: routeDirectionLabel(mode),
      },
    })),
  };
}

// Graph-mode result → GeoJSON FeatureCollection (one LineString per edge with
// passes/energy/length). Node coords are fractional cells → [lng,lat] via the
// raw inverse (no +0.5; matches cellFracToLatLng).
function graphEdgesFC(graph, result, dem) {
  const lonlat = (r, c) => [dem.originX + c * dem.dx, dem.originY - r * dem.dy];
  const passes = result.edgePasses, energy = result.edgeEnergy;
  return {
    type: "FeatureCollection",
    features: Array.from({ length: graph.nEdges }, (_, e) => ({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          lonlat(graph.nodeR[graph.edgeA[e]], graph.nodeC[graph.edgeA[e]]),
          lonlat(graph.nodeR[graph.edgeB[e]], graph.nodeC[graph.edgeB[e]]),
        ],
      },
      properties: {
        passes: passes ? passes[e] : 0,
        energy: energy && Number.isFinite(energy[e]) ? energy[e] : null,
        length_m: graph.edgeLenM[e],
      },
    })),
  };
}

function buildMetadata(result, withOutputs = true) {
  const dem = state.dem;
  const params = {
    mode:          document.getElementById("mode")?.value,
    // v2 physics inputs (the cost bundle is derived from these — see readCost).
    mass:          parseFloat(document.getElementById("mass")?.value),
    crr:           parseFloat(document.getElementById("crr")?.value),
    cda:           parseFloat(document.getElementById("cda")?.value),
    rho:           parseFloat(document.getElementById("rho")?.value),
    keff:          parseFloat(document.getElementById("keff")?.value),
    pFlat:         parseFloat(document.getElementById("pflat")?.value),
    kSmooth:       parseFloat(document.getElementById("ksmooth")?.value),
    deadbandM:     parseFloat(document.getElementById("deadband")?.value),
    // DEM pre-smoothing (v55): the knob setting AND the σ actually applied to
    // the loaded DEM (0 = none) — replay disclosure; results were computed on
    // the smoothed surface, and the auto rule is deterministic per DEM+knob.
    demSmooth:     document.getElementById("dem-smooth")?.value ?? "auto",
    demSmoothAppliedSigmaM: state.dem?.smoothSigmaM ?? 0,
    climbThr:      parseFloat(document.getElementById("climb-thr")?.value) / 100,
    eMax:          parseFloat(document.getElementById("e-max")?.value) || 0,
    eMaxMode:      document.getElementById("e-max-mode")?.value || "leg",
    src:           state.src,
    dst:           state.dst,
    // Sempre true desde o v68 (checkbox removido) — mantido no bundle para
    // que versões antigas do app importem com o checkbox marcado.
    wantPasses:    true,
    wantTopN:      !!document.getElementById("want-topn")?.checked,
    nRoutes:       parseInt(document.getElementById("n-routes")?.value, 10) || 3,
    penalty:       parseFloat(document.getElementById("penalty")?.value) || 2.0,
    repulsionMode: document.getElementById("repulsion-mode")?.value || "per-cell",
    wantDensity:   !!document.getElementById("want-density")?.checked,
    nRefs:         parseInt(document.getElementById("n-refs")?.value, 10) || 10,
    refSource:     document.getElementById("ref-sampling")?.value || "random",
    maximize:      !!document.getElementById("maximize")?.checked,
    maximizeLength: parseInt(document.getElementById("maximize-length")?.value, 10) || 0,
    nDirs:         parseInt(document.getElementById("n-dirs")?.value, 10) || 8,
    stringPull:    !!document.getElementById("string-pull")?.checked,
    kpiCorr:       parseFloat(document.getElementById("kpi-corr")?.value) || 1,
    // refPoints carries the actual placed points so reload can re-stamp
    // the green markers exactly where they were.
    refPoints:     Array.isArray(state.refPoints) ? state.refPoints.slice() : [],
  };
  const viz = {
    fieldColormap:  activeColormap,
    routesColormap: document.getElementById("routes-colormap")?.value || "CET_R2",
    energy: {
      vmin:    readRangeInput("vmin", null),
      vmax:    readRangeInput("vmax", null),
      opacity: parseFloat(document.getElementById("energy-opacity")?.value),
      visible: !!document.getElementById("energy-visible")?.checked,
    },
    passes: {
      vmin:       readRangeInput("passes-vmin", null),
      vmax:       readRangeInput("passes-vmax", null),
      opacity:    parseFloat(document.getElementById("passes-opacity")?.value),
      visible:    !!document.getElementById("passes-visible")?.checked,
      blend:      document.getElementById("passes-blend")?.value || "plus-lighter",
      gamma:      parseFloat(document.getElementById("passes-gamma")?.value),
      meanWindow: parseInt(document.getElementById("passes-mean-window")?.value, 10) || 1,
    },
    tile: {
      url:     RMSAMPA_URL,
      opacity: parseFloat(document.getElementById("tile-opacity")?.value),
      visible: !!document.getElementById("tile-visible")?.checked,
    },
    relief: {
      opacity: parseFloat(document.getElementById("relief-opacity")?.value),
      visible: !!document.getElementById("relief-visible")?.checked,
    },
  };
  // Vector network constraint, if loaded. The actual rasterised mask is
  // saved separately as `network.bin` (see downloadBundle).
  const network = {
    enabled:           !!state.networkMask,
    constrain:         !!document.getElementById("vec-constrain")?.checked,
    compare:           !!document.getElementById("vec-compare")?.checked,
    graphMode:         !!document.getElementById("vec-graph-mode")?.checked,
    junctionMode:      graphJunctionMode(),
    srsId:             state.networkSrsId || null,
    featureCount:      state.networkFeatureCount || 0,
    lineWidth:         parseInt(document.getElementById("vec-width")?.value, 10) || 1,
    snapRadius:        parseInt(document.getElementById("vec-snap")?.value, 10) || 10,
    renderWidthM:      networkLineWidthM(),
    renderOpacity:     networkLineOpacity(),
    wantInterp:        !!document.getElementById("net-interp")?.checked,
    interpMaxDistance: parseInt(document.getElementById("net-interp-max-dist")?.value, 10) || 50,
    interpSmoothing:   parseInt(document.getElementById("net-interp-smoothing")?.value, 10) || 0,
  };
  // Impassable mask + bridge-corridor settings (the resampled mask raster is
  // saved separately as impassable.tif — see downloadBundle).
  const impassable = {
    enabled:          !!state.impassable,
    apply:            impassableEnabled(),
    corridorOverride: !!document.getElementById("imp-corridor")?.checked,
    elevationOffset:  corridorOffsetMetres(),
    invert:           !!document.getElementById("impassable-invert")?.checked,
    show:             !!document.getElementById("imp-show")?.checked,
    opacity:          impassableOverlayOpacity(),
    sourceName:       state.impassableMeta?.name || null,
    srcWidth:         state.impassableMeta?.width || null,
    srcHeight:        state.impassableMeta?.height || null,
    srs:              state.impassableMeta?.srs || null,
    cells:            state.impassableMeta?.cellsImpassable || 0,
  };
  // OSM bridges & tunnels (geometry saved separately as bridges.geojson).
  const bridges = {
    enabled:  !!(state.bridges && state.bridges.length),
    apply:    bridgesEnabled(),
    count:    state.bridges ? state.bridges.length : 0,
    source:   state.bridgesMeta?.source || null,
    tunnels:  !!document.getElementById("bridge-tunnels")?.checked,
    show:     !!document.getElementById("bridge-show")?.checked,
    opacity:  bridgeOverlayOpacity(),
  };

  const md = {
    "@context":           SIMU_CONTEXT,
    "@type":              "EnergyFieldComputation",
    "schema:dateCreated": new Date().toISOString(),
    timestamp:            new Date().toISOString(),
    // schemaVersion 3: outputs are GeoTIFFs (energy.tif/passes.tif/network.tif)
    // instead of raw .bin dumps, so the unzipped bundle drops directly into
    // QGIS. v2 bundles with .bin still load — see loadBundleFile fallback.
    schemaVersion:        3,
    // engine is always "js" now (wasm removed). Kept in the metadata for
    // round-trip compatibility with older bundle readers.
    engine:               "js",
    // Full control state (every persisted toggle/value + layer order, compute
    // source, max-workers, language) so a bundle round-trips the WHOLE UI, not
    // just the params/viz subset below. applyMetadataToUI applies it first.
    // forBundle:true strips connection settings (backend/orchestrator URL,
    // cloud-keep-warm) and computeSource — a shared bundle must not leak the
    // exporter's endpoints or repoint the importer's compute source.
    config:               collectConfig({ forBundle: true }),
    elapsedMs:            result?.elapsedMs ?? null,
    dem: {
      label:        state.demLabel || null,
      sourceUrl:    state.demSourceUrl || null,
      H:            dem.H,
      W:            dem.W,
      originX:      dem.originX,
      originY:      dem.originY,
      dx:           dem.dx,
      dy:           dem.dy,
      dxM:          dem.dxM,
      dyM:          dem.dyM,
      isGeographic: dem.isGeographic,
    },
    params,
    viz,
    network,
    impassable,
    bridges,
    stats: {
      maxE:        state.lastAutoMax ?? null,
      maxPasses:   state.lastPassesAutoMax ?? null,
      pathEnergy:  result?.pathEnergy ?? null,
      pathLengthM: result?.pathLengthM ?? null,
      pathAltEnergy:  result?.pathAltEnergy ?? null,
      pathAltLengthM: result?.pathAltLengthM ?? null,
    },
  };

  if (withOutputs) {
    // Each raster output is a GeoTIFF — same CRS / extent / pixel grid as
    // the source DEM, so QGIS can stack them on top without reprojection.
    // The "type" hint encodes the pixel datatype so the loader knows which
    // typed array to read into; "format" disambiguates from older v2 .bin.
    // network/impassable/bridges reflect state (not the grid `result`) and
    // are unconditionally present here — a graph-mode bundle's zip carries
    // them too (downloadBundle), so they must not be gated on `result` or a
    // null-result (graph) call would wrongly drop their descriptors.
    md.outputs = {
      network: state.networkMask ? {
        format: "GeoTIFF",
        type:   "Uint8",
        shape:  [dem.H, dem.W],
        file:   "network.tif",
      } : null,
      impassable: state.impassable ? {
        format: "GeoTIFF",
        type:   "Uint8",
        shape:  [dem.H, dem.W],
        file:   "impassable.tif",
      } : null,
      bridges: (state.bridges && state.bridges.length) ? {
        format: "GeoJSON",
        file:   "bridges.geojson",
      } : null,
    };
    // The rest describe grid-compute outputs — gate the whole set on
    // `result` so the metadata never claims a file the zip omits (a caller
    // passing result:null, e.g. downloadBundle in graph mode, gets none of
    // these; the zip writers there are gated on !graphMode too).
    if (result) {
      md.outputs.energy = result.energy ? {
        format: "GeoTIFF",
        type:   "Float32",
        shape:  [dem.H, dem.W],
        file:   "energy.tif",
      } : null;
      md.outputs.passes = result.passes ? {
        format: "GeoTIFF",
        type:   "Float64",
        shape:  [dem.H, dem.W],
        file:   "passes.tif",
      } : null;
      // Alternate ("compare with the unconstrained / no-network") scenario: the
      // unconstrained energy + passes and the precomputed (network-masked, interp-
      // filled) difference field — what the difference/unconstrained views render.
      // Only the GRID compare path writes these (graph-mode alt lives on
      // state.lastGraphResult, not exported yet) — kept as a redundant guard,
      // harmless now that the caller already passes result:null for graph mode.
      md.outputs.energyUnconstrained = (!state.lastGraphResult && result.energyAlt?.unconstrained) ? {
        format: "GeoTIFF", type: "Float32", shape: [dem.H, dem.W], file: "energy_unconstrained.tif",
      } : null;
      md.outputs.energyDifference = (!state.lastGraphResult && result.energyAlt?.difference) ? {
        format: "GeoTIFF", type: "Float32", shape: [dem.H, dem.W], file: "energy_difference.tif",
      } : null;
      md.outputs.passesUnconstrained = (!state.lastGraphResult && result.passesAlt?.unconstrained) ? {
        format: "GeoTIFF", type: "Float64", shape: [dem.H, dem.W], file: "passes_unconstrained.tif",
      } : null;
      md.outputs.routes = result.routes && result.routes.length ? {
        format: "GeoJSON",
        file:   "routes.geojson",
      } : null;
      md.outputs.path = result.path && result.path.length ? {
        format: "GeoJSON",
        file:   "path.geojson",
      } : null;
      md.outputs.pathAlt = result.pathAlt && result.pathAlt.length ? {
        format: "GeoJSON",
        file:   "path_alt.geojson",
      } : null;
    }
  }
  return md;
}

// Export the already-rendered energy / passes PNGs (colormap, range, gamma
// and mean filter baked in — byte-identical to what the map overlays show)
// as a zip with ESRI world files (.pgw) + .prj, so they drop into QGIS
// georeferenced. Complements the bundle export, which carries the RAW
// fields as GeoTIFFs.
//
// Deliberately excluded: the relief render (stride-downsampled on huge
// DEMs, so the DEM's dx/dy world file would be wrong for it), and CSS
// blend effects (plus-lighter etc. happen at compositing time in the
// browser, not in the PNG — the "energy color" passes mode IS baked in,
// since that one is painted into the canvas).
const WGS84_WKT =
  'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],' +
  'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]';

async function exportRenderedImages() {
  try {
    if (!state.dem || (!state.lastResult && !state.lastGraphResult)) {
      status.textContent = t("status.nothing_rendered");
      return;
    }
    const items = [];
    if (state.energyDataUrl) items.push(["energy_rendered", state.energyDataUrl]);
    if (state.passesDataUrl) items.push(["passes_rendered", state.passesDataUrl]);
    if (!items.length) {
      status.textContent = t("status.no_layers_export");
      return;
    }
    if (typeof JSZip === "undefined") throw new Error("JSZip didn't load");

    const { dx, dy, originX, originY, isGeographic } = state.dem;
    // World file: pixel size, rotation terms, centre of the top-left pixel.
    // The dataURLs come from renderFieldToDataURL/renderDualPassesToDataURL,
    // which stride-downsample the canvas via overlayCanvasDims above
    // RELIEF_MAX_CANVAS_PX cells — the world file must use the same strided
    // pixel size or the exported PNG is mis-georeferenced on huge DEMs.
    const { stride } = overlayCanvasDims(state.dem.W, state.dem.H);
    const sdx = dx * stride;
    const sdy = dy * stride;
    const worldFile =
      `${sdx}\n0\n0\n${-sdy}\n${originX + sdx / 2}\n${originY - sdy / 2}\n`;

    const zip = new JSZip();
    for (const [name, url] of items) {
      zip.file(`${name}.png`, url.split(",")[1], { base64: true });
      zip.file(`${name}.pgw`, worldFile);
      // Only stamp a CRS we actually know. Projected DEMs still get the
      // world file (correct pixel grid); assign the CRS manually in QGIS.
      if (isGeographic) zip.file(`${name}.prj`, WGS84_WKT);
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, "-").replace(/-Z?$/, "");
    const slug = state.demLabel
      ? state.demLabel.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "_") + "-"
      : "";
    const a = document.createElement("a");
    a.href = url;
    a.download = `simujoules-rendered-${slug}${ts}.zip`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
    status.textContent =
      t("status.exported_layers", items.length, (blob.size / 1024 / 1024).toFixed(1));
  } catch (err) {
    console.error("[export-rendered] failed:", err);
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.export_failed", escapeHtml(err.message))}</span>`;
  }
}

async function downloadBundle() {
  console.info("[bundle] download click — lastResult?", !!state.lastResult, "dem?", !!state.dem, "JSZip?", typeof JSZip);
  if (!state.dem) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.download_need_dem")}</span>`;
    return;
  }
  if (!state.lastResult && !state.lastGraphResult) {
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.download_need_compute")}</span>`;
    return;
  }
  if (typeof JSZip === "undefined") {
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.jszip_failed")}</span>`;
    return;
  }
  status.textContent = t("status.building_bundle");
  try {
    const graphMode = !!state.lastGraphResult;
    const r = state.lastResult || {}; // graph-only bundles carry no grid result
    const dem = state.dem;
    // A graph run does NOT clear state.lastResult, so a session that ran a
    // grid compute before a graph compute would otherwise have buildMetadata
    // describe (stats/elapsedMs/outputs) the STALE grid result while the zip
    // below (all gated on !graphMode) omits those files entirely. Passing
    // null in graph mode makes buildMetadata skip the result-dependent
    // descriptors/stats altogether (network/impassable/bridges still show).
    const md = buildMetadata(graphMode ? null : state.lastResult, true);
    if (graphMode) {
      md.outputs = md.outputs || {};
      md.outputs.graphEdges = { format: "GeoJSON", file: "graph_edges.geojson", junctionMode: graphJunctionMode() };
      // Graph runs carry their own timing separately from md.elapsedMs (which
      // is null now that result is null) — restore it from the graph result.
      md.elapsedMs = state.lastGraphResult.result?.elapsedMs ?? null;
    }

    const zip = new JSZip();
    zip.file("metadata.jsonld", JSON.stringify(md, null, 2));
    // Output rasters as GeoTIFFs — the unzipped bundle drops straight into
    // QGIS / any GIS, no .bin-plus-metadata gymnastics. CRS and pixel grid
    // are inherited from the source DEM via tiffMetadataForDem.
    // Unreachable cells store +Infinity in the energy fields (worker init);
    // tag GDAL_NODATA so GDAL/QGIS report finite min/max/mean instead of
    // inf/nan and don't render a washed-out default stretch. geotiff.js
    // writes it as an ASCII tag and GDAL accepts the literal "inf". Passes
    // rasters are untouched — 0 there is a legitimate "no passes" value, not
    // nodata. Pixel values themselves stay Infinity (bundle reload keeps
    // reconstructing them as-is).
    const ENERGY_NODATA_MD = { GDAL_NODATA: "inf" };
    if (r.energy && !graphMode) {
      zip.file("energy.tif",  new Uint8Array(writeRasterAsGeoTIFF(r.energy, dem, "float32", ENERGY_NODATA_MD)));
    }
    if (r.passes && !graphMode) {
      zip.file("passes.tif",  new Uint8Array(writeRasterAsGeoTIFF(r.passes, dem, "float64")));
    }
    // Alternate scenario for a "Comparar com cenário sem rede" (compare) run:
    // the unconstrained energy/passes and the saved difference field, so the
    // difference / unconstrained views survive a reload (not just the toggle).
    if (r.energyAlt?.unconstrained && !graphMode) {
      zip.file("energy_unconstrained.tif", new Uint8Array(writeRasterAsGeoTIFF(r.energyAlt.unconstrained, dem, "float32", ENERGY_NODATA_MD)));
    }
    if (r.energyAlt?.difference && !graphMode) {
      zip.file("energy_difference.tif", new Uint8Array(writeRasterAsGeoTIFF(r.energyAlt.difference, dem, "float32", ENERGY_NODATA_MD)));
    }
    if (r.passesAlt?.unconstrained && !graphMode) {
      zip.file("passes_unconstrained.tif", new Uint8Array(writeRasterAsGeoTIFF(r.passesAlt.unconstrained, dem, "float64")));
    }
    // The rasterised network mask reproduces the constrained compute even
    // when the source .gpkg isn't handy at reload. Stored as a 1-byte-per-
    // cell GeoTIFF (uint8) so QGIS can also display it as a raster mask.
    if (state.networkMask) {
      zip.file("network.tif", new Uint8Array(writeRasterAsGeoTIFF(state.networkMask, dem, "uint8")));
    }
    // The resampled impassable mask (DEM-aligned uint8) reproduces the blocked
    // water + bridge corridors on reload without re-uploading the source raster.
    if (state.impassable) {
      zip.file("impassable.tif", new Uint8Array(writeRasterAsGeoTIFF(state.impassable, dem, "uint8")));
    }
    // OSM/loaded bridges/tunnels as GeoJSON — re-derived into decks on reload.
    // EXCLUDE user-drawn portals: they round-trip via config.drawn.portals, and
    // including them here would double-add on restore (reappend + reinstall).
    const exportBridges = (state.bridges || []).filter((b) => !b.drawn);
    if (exportBridges.length) {
      zip.file("bridges.geojson", JSON.stringify(bridgesToFC(exportBridges), null, 2));
    }
    if (r.routes && r.routes.length && !graphMode) {
      zip.file("routes.geojson", JSON.stringify(routesFCFromList(r.routes, dem, md.params.mode), null, 2));
    }
    if (r.path && r.path.length && !graphMode) {
      zip.file("path.geojson", JSON.stringify(pathFCFromIndices(r.path, dem, {
        energy: r.pathEnergy,
        length_m: r.pathLengthM,
      }, md.params.mode), null, 2));
    }
    // Compare run: the unconstrained best TERRAIN route, so the scenario picker's
    // route comparison comes back on import without a recompute (mirrors energyAlt).
    if (r.pathAlt && r.pathAlt.length && !graphMode) {
      zip.file("path_alt.geojson", JSON.stringify(pathFCFromIndices(r.pathAlt, dem, {
        scenario: "terrain",
        energy: r.pathAltEnergy,
        length_m: r.pathAltLengthM,
      }, md.params.mode), null, 2));
    }
    // "Follow the vectors" result → per-edge GeoJSON (passes/energy/length).
    if (state.lastGraphResult) {
      zip.file("graph_edges.geojson", JSON.stringify(
        graphEdgesFC(state.lastGraphResult.graph, state.lastGraphResult.result, dem), null, 2));
    }

    // KNOWN LIMITATION (documented, not fixed here): for a huge compare run
    // (e.g. 135M cells with passes) the GeoTIFF copies above (~4 GB: energy
    // f32 + passes f64 + the three *_unconstrained/*_difference variants)
    // are all held in `zip` at once, and generateAsync({type:"blob"}) then
    // accumulates the whole archive into a second in-memory buffer on top of
    // that — plus state.lastResult's own ~3.8 GB. `streamFiles: true` does
    // NOT fix this (it only changes how each entry's data descriptor is
    // written, not whether generateAsync's accumulate() buffers the output
    // blob) — don't add it here as if it were a mitigation. A real fix needs
    // to never materialise the full zip as one JS buffer at all, e.g.
    // zip.generateInternalStream(...) piped chunk-by-chunk into a
    // showSaveFilePicker() FileSystemWritableFileStream (with a fallback to
    // this Blob path where the File System Access API is unavailable) — out
    // of scope for this pass; revisit if 100M+-cell compare exports become
    // a routine workflow.
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, "-").replace(/-Z?$/, "");
    const slug = state.demLabel ? state.demLabel.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "_") + "-" : "";
    const a = document.createElement("a");
    a.href = url;
    a.download = `simujoules-${slug}${ts}.zip`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
    status.textContent = t("status.bundle_saved", (blob.size / 1024 / 1024).toFixed(1));
  } catch (err) {
    console.error("[bundle] download failed:", err);
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.download_failed", escapeHtml(err.message))}</span>`;
  }
}

// Read a bundle (.zip with metadata.jsonld + arrays) or a bare .jsonld and
// restore as much UI/state as possible. After restoration: if a matching
// DEM is already loaded, src/dst markers are placed and the user can click
// Compute to reproduce. If no DEM, the status nudges them to load one.
async function loadBundleFile(file) {
  try {
    let md;
    let bin = {}; // { energy: Float32Array, passes: Float64Array, ... }
    if (/\.zip$/i.test(file.name)) {
      if (typeof JSZip === "undefined") throw new Error("JSZip didn't load");
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const mdEntry = zip.file("metadata.jsonld") || zip.file("metadata.json");
      if (!mdEntry) throw new Error("No metadata.jsonld inside the archive.");
      // Zip-bomb guard: JSZip's central-directory parse is cheap, but each
      // .async() call below fully decompresses that entry into memory — zip
      // compresses ~1000:1, so a crafted few-hundred-KB bundle could declare
      // multi-GB members and OOM the tab before any H×W/length check further
      // down ever runs. `_data.uncompressedSize` is JSZip-internal — guard
      // with optional chaining so a JSZip upgrade degrades to no-cap rather
      // than breaking legitimate imports.
      const entrySize = (e) => e?._data?.uncompressedSize ?? 0;
      const capEntry = (e, label, cap) => {
        if (e && entrySize(e) > cap) {
          throw new Error(`${label}: decompressed size exceeds the safety cap — refusing to load (corrupt or hostile bundle?).`);
        }
      };
      const TEXT_CAP = 64 * 1024 * 1024; // 64 MiB — metadata.jsonld / each .geojson is plain text, never legitimately this big
      capEntry(mdEntry, "metadata.jsonld", TEXT_CAP);
      md = JSON.parse(await mdEntry.async("string"));
      // Raster cap: derive the expected cell count from the bundle's OWN
      // declared dims (parsed above, before any raster .async() call) rather
      // than whatever DEM happens to be loaded in this tab — a hostile
      // bundle could otherwise just lie about md.dem.H/W to dodge a
      // DEM-derived cap. A hard absolute ceiling bounds it even if it lies
      // about its own dims too. The flagship DEM is ~135M cells (passes.tif
      // ≈1.08 GB float64) — size generously above that, not from a small
      // constant, or a legit huge bundle would get rejected.
      const HARD_CELL_CEILING = 200e6; // generous headroom over the ~135M-cell flagship DEM
      const bundleCells =
        Number.isFinite(md?.dem?.H) && Number.isFinite(md?.dem?.W) ? md.dem.H * md.dem.W : null;
      const cellCap = Math.min(bundleCells ?? (state.dem ? state.dem.H * state.dem.W : 50e6), HARD_CELL_CEILING);
      const RASTER_CAP = cellCap * 8 + 65536; // float64/passes worst case + TIFF header overhead
      // v3 bundles use GeoTIFFs for the rasters; v2 used raw little-endian
      // .bin dumps. Try .tif first, fall back to .bin so old bundles still
      // load after this change.
      const eTif = zip.file("energy.tif"),  eBin = zip.file("energy.bin");
      capEntry(eTif, "energy.tif", RASTER_CAP); capEntry(eBin, "energy.bin", RASTER_CAP);
      if (eTif) {
        bin.energy = await readRasterFromGeoTIFF(await eTif.async("arraybuffer"), "float32");
      } else if (eBin) {
        bin.energy = new Float32Array(await eBin.async("arraybuffer"));
      }
      const pTif = zip.file("passes.tif"),  pBin = zip.file("passes.bin");
      capEntry(pTif, "passes.tif", RASTER_CAP); capEntry(pBin, "passes.bin", RASTER_CAP);
      if (pTif) {
        bin.passes = await readRasterFromGeoTIFF(await pTif.async("arraybuffer"), "float64");
      } else if (pBin) {
        bin.passes = new Float64Array(await pBin.async("arraybuffer"));
      }
      // Alternate-scenario rasters (compare view): unconstrained energy/passes +
      // the saved difference field. Held on `bin` so the pending-DEM replay picks
      // them up too; reconstructed onto state.lastResult.energyAlt/passesAlt below.
      const euTif = zip.file("energy_unconstrained.tif");
      capEntry(euTif, "energy_unconstrained.tif", RASTER_CAP);
      if (euTif) bin.energyUnconstrained = await readRasterFromGeoTIFF(await euTif.async("arraybuffer"), "float32");
      const edTif = zip.file("energy_difference.tif");
      capEntry(edTif, "energy_difference.tif", RASTER_CAP);
      if (edTif) bin.energyDifference = await readRasterFromGeoTIFF(await edTif.async("arraybuffer"), "float32");
      const puTif = zip.file("passes_unconstrained.tif");
      capEntry(puTif, "passes_unconstrained.tif", RASTER_CAP);
      if (puTif) bin.passesUnconstrained = await readRasterFromGeoTIFF(await puTif.async("arraybuffer"), "float64");
      const nTif = zip.file("network.tif"), nBin = zip.file("network.bin");
      capEntry(nTif, "network.tif", RASTER_CAP); capEntry(nBin, "network.bin", RASTER_CAP);
      if (nTif) {
        bin.network = await readRasterFromGeoTIFF(await nTif.async("arraybuffer"), "uint8");
      } else if (nBin) {
        bin.network = new Uint8Array(await nBin.async("arraybuffer"));
      }
      const iTif = zip.file("impassable.tif");
      capEntry(iTif, "impassable.tif", RASTER_CAP);
      if (iTif) bin.impassable = await readRasterFromGeoTIFF(await iTif.async("arraybuffer"), "uint8");
      const brGeo = zip.file("bridges.geojson");
      capEntry(brGeo, "bridges.geojson", TEXT_CAP);
      if (brGeo) { try { bin.bridgesFC = JSON.parse(await brGeo.async("string")); } catch {} }
      // Route/path vector geometry. These ride alongside the rasters and get
      // re-rendered (converted back to cell indices) once a matching DEM is
      // present — no recompute needed. Held in `bin` so the pending-bundle
      // replay (loadDemFromArrayBuffer) picks them up too.
      const rGeo = zip.file("routes.geojson");
      capEntry(rGeo, "routes.geojson", TEXT_CAP);
      if (rGeo) { try { bin.routesFC = JSON.parse(await rGeo.async("string")); } catch {} }
      const pGeo = zip.file("path.geojson");
      capEntry(pGeo, "path.geojson", TEXT_CAP);
      if (pGeo) { try { bin.pathFC = JSON.parse(await pGeo.async("string")); } catch {} }
      const paGeo = zip.file("path_alt.geojson");
      capEntry(paGeo, "path_alt.geojson", TEXT_CAP);
      if (paGeo) { try { bin.pathAltFC = JSON.parse(await paGeo.async("string")); } catch {} }
    } else if (/\.jsonld?$|\.json$/i.test(file.name)) {
      md = JSON.parse(await file.text());
    } else {
      throw new Error("Unrecognised file — pass a .zip bundle or .jsonld.");
    }
    applyMetadataToUI(md, bin);
  } catch (err) {
    console.error(err);
    status.innerHTML = `<span style="color:#ff6b6b">${t("status.reload_failed", escapeHtml(err.message))}</span>`;
  }
}

function applyMetadataToUI(md, bin = {}) {
  // Bundle import mutates the compute grid (networkMask/impassable below) —
  // per the invariant, cancel any in-flight run BEFORE anything a result
  // would render against changes. Importing a bundle supersedes it anyway.
  cancelActiveCompute();
  const p = md.params || {};
  const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
  const check = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.checked = !!v; };

  // Restore the FULL control state first (every persisted toggle/value + layer
  // order, compute source, max-workers, language). The result-specific blocks
  // below (src/dst, refPoints, energy/passes ranges, DEM-gated binaries) then
  // refine on top. Older bundles without md.config fall through unchanged.
  // persist:false — a bundle restores the session UI but must not overwrite the
  // user's saved language / params / layer order / max-workers on disk.
  if (md.config) { try { applyConfig(md.config, { persist: false }); } catch (e) { console.warn("[bundle] applyConfig failed", e); } }

  // Graph-mode bundles (network.graphMode / outputs.graphEdges) can't restore
  // their result — graph_edges.geojson needs the full graph object, not just
  // edge geometry (see CHANGELOG) — and the vector network LINES themselves
  // don't travel in the bundle either (only the rasterised network.tif
  // mask does). Detected here so the final status cascade below can warn
  // instead of silently letting the next Compute click fall back to the
  // raster engine (dispatchCompute only takes the graph path when
  // state.networkLines is populated).
  const graphBundle = !!(md.outputs?.graphEdges || md.network?.graphMode);

  // ---- DEM dimension + georeferencing check ------------------------------
  // Binary outputs (energy/passes/network) are sized to the bundle's DEM.
  // Replaying them onto a different DEM would corrupt the visualisation,
  // so we gate the binary path on a strict match. Parameters/UI still get
  // applied — the user is told to re-Compute.
  const bundleH = md.dem?.H, bundleW = md.dem?.W;
  const demDimsMatch =
    state.dem && Number.isFinite(bundleH) && Number.isFinite(bundleW)
      ? state.dem.H === bundleH && state.dem.W === bundleW
      : null; // null = unknown (no DEM loaded yet, or bundle didn't record dims)
  // demMatch additionally checks the geotransform (bundleDemMatch) — same
  // H×W is not proof of the same DEM: many DEM products (all 1° SRTM/FABDEM
  // tiles, say) share pixel dimensions while covering a different area, and
  // replaying tile-A rasters/routes over tile-B's extent renders silently
  // wrong (lonLatToPixel's own comment flags this same invariant).
  const demMatch = bundleDemMatch(md.dem, state.dem);
  // True only when dims matched but the geotransform didn't — used below to
  // pick the right status message (a dims mismatch already has its own).
  const demExtentMismatch = !!state.dem && demDimsMatch === true && demMatch === false;
  if (state.dem && demDimsMatch === false) {
    console.warn(
      `[bundle] DEM dimension mismatch: bundle ${bundleW}×${bundleH}, ` +
      `loaded ${state.dem.W}×${state.dem.H}. Skipping binary replay.`
    );
  } else if (demExtentMismatch) {
    console.warn(
      `[bundle] DEM extent mismatch despite matching ${bundleW}×${bundleH} dims ` +
      `— likely a different tile at the same size. Skipping binary replay.`
    );
  }

  // No DEM yet (or the wrong one, dims OR georeferencing): hold the full
  // bundle — rasters included — so loadDemFromArrayBuffer can re-apply it
  // when a matching DEM lands. A successful full application clears the slot.
  state.pendingBundle = (!state.dem || demMatch === false) ? { md, bin } : null;

  set("mode", p.mode);
  // v2 physics inputs (older bundles carried α/β/η, which no longer map cleanly —
  // they're ignored, the defaults stand).
  set("mass", p.mass);
  set("crr", p.crr);
  set("cda", p.cda);
  set("rho", p.rho);
  set("keff", p.keff);
  set("pflat", p.pFlat);
  set("ksmooth", p.kSmooth);
  set("deadband", p.deadbandM);
  // DEM pre-smoothing knob (v55). Old bundles (< v55) carry no demSmooth —
  // leave the current selection alone rather than resetting it.
  if (p.demSmooth != null) set("dem-smooth", p.demSmooth);
  set("climb-thr", p.climbThr != null ? p.climbThr * 100 : p.climbThr); // bundle stores grade; input is %
  set("e-max", p.eMax);
  set("e-max-mode", p.eMaxMode);
  // p.wantPasses é ignorado desde o v68 — passes sempre são calculadas.
  check("want-topn", p.wantTopN);
  set("n-routes", p.nRoutes);
  set("penalty", p.penalty);
  set("repulsion-mode", p.repulsionMode);
  check("want-density", p.wantDensity);
  check("maximize", p.maximize);
  set("maximize-length", p.maximizeLength);
  // v57 additions — old bundles carry none of these; leave the UI alone then.
  if ([4, 8, 16, 32, 64, 128].includes(p.nDirs)) set("n-dirs", p.nDirs);
  if (p.stringPull != null) check("string-pull", p.stringPull);
  if (Number.isFinite(p.kpiCorr)) set("kpi-corr", Math.min(1.5, Math.max(1, p.kpiCorr)));
  set("n-refs", p.nRefs);
  // Legacy bundles may carry the pre-rename "click" value (or any other
  // stale string) — only accept values the current #ref-sampling select
  // actually has, so we never write garbage into the UI.
  if (["random", "sobol", "halton", "census"].includes(p.refSource)) {
    set("ref-sampling", p.refSource);
  }

  const v = md.viz || {};
  if (v.fieldColormap && COLORMAPS[v.fieldColormap]) {
    activeColormap = v.fieldColormap;
    const sel = document.getElementById("colormap"); if (sel) sel.value = v.fieldColormap;
    applyColormapToLegend();
  }
  if (v.routesColormap && COLORMAPS[v.routesColormap]) {
    set("routes-colormap", v.routesColormap);
  }
  if (v.energy) {
    set("vmin", v.energy.vmin);
    set("vmax", v.energy.vmax);
    set("energy-opacity", v.energy.opacity);
    check("energy-visible", v.energy.visible);
  }
  if (v.passes) {
    set("passes-vmin", v.passes.vmin);
    set("passes-vmax", v.passes.vmax);
    set("passes-opacity", v.passes.opacity);
    check("passes-visible", v.passes.visible);
    set("passes-blend", v.passes.blend);
    set("passes-gamma", v.passes.gamma);
    set("passes-mean-window", v.passes.meanWindow);
  }
  if (v.tile) {
    set("tile-opacity", v.tile.opacity);
    check("tile-visible", v.tile.visible);
  }
  if (v.relief) {
    set("relief-opacity", v.relief.opacity);
    check("relief-visible", v.relief.visible);
  }

  // ---- Vector network params ---------------------------------------------
  // Slider/checkbox values from the bundle's `network` section. Mask
  // restoration happens further down once we've also confirmed DEM dims.
  const net = md.network || {};
  set("vec-width", net.lineWidth);
  set("vec-snap", net.snapRadius);
  check("net-interp", net.wantInterp);
  check("vec-constrain", net.constrain);
  check("vec-compare", net.compare);
  check("vec-graph-mode", net.graphMode);
  if (net.junctionMode) set("vec-junction-mode", net.junctionMode);
  set("net-interp-max-dist", net.interpMaxDistance);
  set("net-interp-smoothing", net.interpSmoothing);
  set("vec-render-width", net.renderWidthM);
  set("vec-render-opacity", net.renderOpacity);
  updateNetworkLineStyle();

  // ---- Impassable mask params (mask restore happens further down) --------
  const imp = md.impassable || {};
  check("imp-enabled", imp.apply);
  check("impassable-invert", imp.invert);
  set("imp-offset", Number.isFinite(imp.elevationOffset) ? imp.elevationOffset : 0);
  set("imp-opacity", Number.isFinite(imp.opacity) ? imp.opacity : 0.5);
  check("imp-corridor", imp.corridorOverride);
  check("imp-show", imp.show);
  // Reveal the dependent rows to match the restored toggles (without firing the
  // change handlers — corridors are recomputed once the mask is restored below).
  { const r = document.getElementById("imp-offset-row");
    if (r) r.style.display = document.getElementById("imp-corridor")?.checked ? "" : "none"; }
  { const r = document.getElementById("imp-opacity-row");
    if (r) r.style.display = document.getElementById("imp-show")?.checked ? "" : "none"; }

  // ---- Bridge/tunnel params (geometry restore happens further down) -------
  const br = md.bridges || {};
  check("bridge-enabled", br.apply);
  check("bridge-tunnels", br.tunnels);
  check("bridge-show", br.show);
  set("bridge-opacity", Number.isFinite(br.opacity) ? br.opacity : 0.9);

  // (Engine preference is no longer user-selectable — JS only.
  // md.enginePreference from older bundles is read but ignored.)

  // Trigger UI sync for toggles that reveal/hide their option groups —
  // top-N exposes the routes-count + repulsion controls, density swaps
  // src/dst for the multi-ref UI and disables/enables the energy layer.
  const topnCheck = document.getElementById("want-topn");
  if (topnCheck) topnCheck.dispatchEvent(new Event("change"));
  const densityCheck = document.getElementById("want-density");
  if (densityCheck) densityCheck.dispatchEvent(new Event("change"));
  // maximize reveals the L-length input and greys out the (inapplicable)
  // energy-budget field — resync those too.
  const maximizeCheck = document.getElementById("maximize");
  if (maximizeCheck) maximizeCheck.dispatchEvent(new Event("change"));
  // #mode toggles the "Budget applies to" (e-max-mode) row's visibility —
  // v3 app-exported bundles get this for free via applyConfig's
  // PERSIST_REFIRE, but bundles with no md.config (census/CLI bundles,
  // pre-v40-era bundles) restore set("mode", ...) above with no change
  // event, leaving the row's visibility stale. Idempotent to re-fire even
  // when applyConfig already did (just toggles a style, no recompute).
  const modeSel = document.getElementById("mode");
  if (modeSel) modeSel.dispatchEvent(new Event("change"));

  // Restore src/dst pixel positions. If a DEM is loaded that matches the
  // bundle's DEM dimensions, place markers right away; otherwise hold the
  // values for when the DEM gets loaded.
  if (Array.isArray(p.src)) state.src = p.src.slice(0, 2);
  if (Array.isArray(p.dst)) state.dst = p.dst.slice(0, 2);

  function placeMarker(point, label) {
    if (!state.dem || !point) return null;
    const [r, c] = point;
    const { originX, originY, dx, dy } = state.dem;
    const latlng = L.latLng(originY - (r + 0.5) * dy, originX + (c + 0.5) * dx);
    return L.marker(latlng, { icon: makeSrcDstIcon(label === "Source" ? "src" : "dst") })
      .addTo(map).bindTooltip(label);
  }
  // Don't drop markers onto a mismatched DEM — they'd land on bogus pixels.
  // Also skip in density mode — the "Pick points" UI is hidden / disabled
  // there and stale src/dst markers would just clutter the map.
  const densityOnNow = !!document.getElementById("want-density")?.checked;
  if (state.dem && state.src && demMatch !== false && !densityOnNow) {
    if (state.srcMarker) state.srcMarker.remove();
    state.srcMarker = placeMarker(state.src, "Source");
    document.getElementById("src-display").textContent = `r=${state.src[0]}, c=${state.src[1]}`;
    document.getElementById("src-display").classList.add("set");
  }
  if (state.dem && state.dst && demMatch !== false && !densityOnNow) {
    if (state.dstMarker) state.dstMarker.remove();
    state.dstMarker = placeMarker(state.dst, "Destination");
    document.getElementById("dst-display").textContent = `r=${state.dst[0]}, c=${state.dst[1]}`;
    document.getElementById("dst-display").classList.add("set");
  }

  // ---- Reference points (multi-ref density) ------------------------------
  // Re-stamp the FIFO ring exactly as it was. addRefPoint pushes + numbers
  // the markers and respects enforceRefCap, so the cap field set above
  // governs how many actually survive.
  if (Array.isArray(p.refPoints) && state.dem && demMatch !== false) {
    // Clear whatever is on the map from a previous bundle / run.
    if (state.refMarkers) for (const m of state.refMarkers) m.remove();
    state.refMarkers = [];
    state.refPoints = [];
    for (const rc of p.refPoints) {
      if (Array.isArray(rc) && rc.length >= 2) addRefPoint([rc[0] | 0, rc[1] | 0]);
    }
    syncRefDisplay();
  }

  // ---- Network mask restore ---------------------------------------------
  // Only when we have a DEM, dims match, and the byte length matches H*W.
  // Otherwise leave the slot empty — better to recompute than to load a
  // mask that points at the wrong cells.
  if (bin.network && state.dem && demMatch === true) {
    const N = state.dem.H * state.dem.W;
    if (bin.network.length === N) {
      state.networkMask = bin.network;
      state.networkSrsId = net.srsId || null;
      state.networkFeatureCount = net.featureCount || 0;
      const meta = document.getElementById("vec-meta");
      if (meta) {
        // srsId / featureCount come from the bundle's metadata.jsonld, which a
        // shared/crafted bundle controls — escape before innerHTML (stored XSS).
        meta.innerHTML =
          `Restored from bundle: <span class="v">${escapeHtml(String(state.networkFeatureCount))}</span> ` +
          `features (SRS ${escapeHtml(String(state.networkSrsId ?? "?"))}).`;
      }
    } else {
      console.warn(
        `[bundle] network.bin size mismatch: ${bin.network.length} bytes vs H*W=${N}. Discarded.`
      );
    }
  }

  // ---- Impassable mask restore -------------------------------------------
  // After the network mask (corridors depend on it) and under the same dim
  // check. We only have the DEM-aligned resampled mask here, not the source
  // raster, so the Invert toggle won't re-resample (already baked in).
  if (bin.impassable && state.dem && demMatch === true) {
    const N = state.dem.H * state.dem.W;
    if (bin.impassable.length === N) {
      let cells = 0;
      for (let i = 0; i < N; i++) if (bin.impassable[i]) cells++;
      state.impassable = bin.impassable;
      state.impassableMeta = {
        name: imp.sourceName || "mask", width: imp.srcWidth || null,
        height: imp.srcHeight || null, srs: imp.srs || null, cellsImpassable: cells,
      };
      recomputeCorridors();
      updateImpassableMeta();
      updateCorridorAvailability();
      applyImpassableOverlay();
    } else {
      console.warn(`[bundle] impassable.tif size mismatch: ${bin.impassable.length} vs H*W=${N}. Discarded.`);
    }
  }

  // ---- Bridges/tunnels restore -------------------------------------------
  // Re-derive decks from the saved GeoJSON (endA/endB depend on the grid, so
  // only under a dimension match). installBridgesFromWays handles overlay +
  // invalidation, mirroring a fresh OSM pull.
  if (bin.bridgesFC && state.dem && demMatch === true) {
    const ways = (bin.bridgesFC.features || [])
      .filter((f) => f.geometry?.type === "LineString" && Array.isArray(f.geometry.coordinates))
      .map((f) => ({
        latlngs: f.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
        kind: f.properties?.kind || "bridge",
        layer: f.properties?.layer || 0,
        name: f.properties?.name || null,
        eleA: Number.isFinite(f.properties?.eleA) ? f.properties.eleA : null,
        eleB: Number.isFinite(f.properties?.eleB) ? f.properties.eleB : null,
      }));
    if (ways.length) installBridgesFromWays(ways, "bundle");
  }

  applyLayerControls();
  estimateRunTime();

  // If we got the cached outputs back, render them straight away — no
  // recompute needed. Skip if the DEM dimensions don't match (or no DEM
  // is loaded yet). Routes/path come back from GeoJSON (converted to cell
  // indices); the energy/passes rasters come back from the GeoTIFFs. Any
  // subset is fine — a maximize bundle has a path but no top-N routes, a
  // density bundle has neither.
  let restored = false;
  if (state.dem && demMatch === true) {
    const N = state.dem.H * state.dem.W;
    const energyOk = bin.energy && bin.energy.length === N;
    const passesOk = bin.passes && bin.passes.length === N;
    const routes = routesFromFC(bin.routesFC || null, state.dem);
    const path = routes ? null : pathFromFC(bin.pathFC || null, state.dem);
    const pathAlt = pathFromFC(bin.pathAltFC || null, state.dem);
    // Render whenever we recovered anything drawable; routes take precedence
    // over a lone path (renderResult draws one or the other, mirroring a
    // fresh compute where top-N and maximize are mutually exclusive).
    if (energyOk || passesOk || routes || path || pathAlt) {
      // Rebuild the compare scenarios from the alt rasters so the displayed-
      // scenario picker + the difference/unconstrained views come back (not just
      // the toggle). renderResult shows #energy-source-row when these are present.
      const eu = bin.energyUnconstrained?.length === N ? bin.energyUnconstrained : null;
      const ed = bin.energyDifference?.length === N ? bin.energyDifference : null;
      const pu = bin.passesUnconstrained?.length === N ? bin.passesUnconstrained : null;
      const energyAlt = (eu || ed) ? { unconstrained: eu, difference: ed } : null;
      const passesAlt = pu ? { unconstrained: pu } : null;
      const synth = {
        energy:      energyOk ? bin.energy : null,
        passes:      passesOk ? bin.passes : null,
        path,
        pathEnergy:  md.stats?.pathEnergy ?? null,
        pathLengthM: md.stats?.pathLengthM ?? null,
        routes,
        elapsedMs:   md.elapsedMs ?? 0,
        energyAlt,
        passesAlt,
        pathAlt,
        pathAltEnergy:  md.stats?.pathAltEnergy ?? null,
        pathAltLengthM: md.stats?.pathAltLengthM ?? null,
      };
      renderResult(synth);
      setGroupOpen("result-group", true); // bundle loaded a result → reveal it
      restored = true;
    }
  }

  updateRunButtonState();
  if (restored) {
    status.textContent = t("status.bundle_restored");
  } else if (state.dem && demDimsMatch === false) {
    status.innerHTML =
      `<span style="color:#ff9d3d">${t("status.bundle_dem_mismatch", bundleW, bundleH, state.dem.W, state.dem.H)}</span>`;
  } else if (demExtentMismatch) {
    status.innerHTML =
      `<span style="color:#ff9d3d">${t("status.bundle_dem_extent_mismatch", bundleW, bundleH)}</span>`;
  } else if (graphBundle && !(state.networkLines && state.networkLines.length)) {
    // Graph-mode bundle, no vector network loaded: warn instead of letting
    // the user believe Compute will reproduce the graph result — it won't,
    // it'll silently run the raster engine (see graphBundle's definition).
    status.innerHTML = `<span style="color:#ff9d3d">${t("status.bundle_graph_not_restored")}</span>`;
  } else if (state.dem && (state.src || (p.wantDensity && state.refPoints?.length))) {
    status.textContent = t("status.bundle_params_loaded");
  } else if (!state.dem) {
    const hint = md.dem?.sourceUrl ? ` (try ${escapeHtml(md.dem.sourceUrl)})` : "";
    status.innerHTML = `<span style="opacity:0.85">${t("status.bundle_need_dem", hint)}</span>`;
  } else {
    status.textContent = t("status.bundle_loaded");
  }
}
