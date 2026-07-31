/*
 * Site-wide broken-image guard.
 * Many <img> tags on this site point at third-party hotlinks (e.g. i.postimg.cc),
 * which can disappear at any time without warning. When that happens this swaps
 * the broken image for a locally-generated placeholder instead of showing the
 * host's ugly "image not found" graphic.
 */
(function () {
    var BG = '#0F172A';
    var BORDER = 'rgba(255,255,255,0.12)';
    var ACCENT = '#22C55E';

    function initials(alt) {
        if (!alt) return '';
        return alt
            .split(',')[0]
            .trim()
            .split(/\s+/)
            .map(function (w) { return w.charAt(0); })
            .join('')
            .slice(0, 2)
            .toUpperCase();
    }

    function isPortrait(img) {
        return !!img.closest('.photo-wrapper, .team-member, .team-grid');
    }

    function svgDataUri(svg) {
        return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
    }

    function portraitPlaceholder(alt) {
        var label = initials(alt) || '?';
        return svgDataUri(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 380" preserveAspectRatio="xMidYMid slice">' +
            '<rect width="300" height="380" fill="' + BG + '"/>' +
            '<circle cx="150" cy="190" r="64" fill="none" stroke="' + BORDER + '" stroke-width="2"/>' +
            '<text x="150" y="203" font-family="Arial, Helvetica, sans-serif" font-size="48" font-weight="700" fill="' + ACCENT + '" text-anchor="middle" dominant-baseline="middle">' + label + '</text>' +
            '</svg>'
        );
    }

    function genericPlaceholder() {
        return svgDataUri(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice">' +
            '<rect width="400" height="240" fill="' + BG + '"/>' +
            '<rect x="1" y="1" width="398" height="238" fill="none" stroke="' + BORDER + '" stroke-width="2"/>' +
            '<g fill="none" stroke="' + ACCENT + '" stroke-width="2" opacity="0.55">' +
            '<rect x="150" y="88" width="100" height="72" rx="4"/>' +
            '<circle cx="173" cy="111" r="8"/>' +
            '<path d="M150 150 L182 122 L204 141 L228 116 L250 150"/>' +
            '</g>' +
            '</svg>'
        );
    }

    document.addEventListener('error', function (event) {
        var img = event.target;
        if (!img || img.tagName !== 'IMG' || img.dataset.fallbackApplied) return;
        // Leaflet manages its own tile images (retries, empty tiles on failure);
        // let it handle its own load errors instead of swapping in our placeholder.
        if (img.classList.contains('leaflet-tile') || img.closest('.leaflet-container')) return;
        img.dataset.fallbackApplied = 'true';
        img.removeAttribute('srcset');
        img.src = isPortrait(img) ? portraitPlaceholder(img.getAttribute('alt')) : genericPlaceholder();
        img.classList.add('img-fallback');
    }, true);
})();
