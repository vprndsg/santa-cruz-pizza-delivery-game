/* Minimal Leaflet EdgeBuffer plugin stub for offline environment */
(function () {
  if (typeof L === 'undefined' || !L.TileLayer) return;
  L.TileLayer.EdgeBuffer = L.TileLayer.extend({
    options: {
      edgeBufferTiles: 0
    },
    _update: function (center) {
      var pixelBounds = this._getTiledPixelBounds(center);
      var tileSize = this._tileSize;
      if (this.options.edgeBufferTiles) {
        var buffer = tileSize.multiplyBy(this.options.edgeBufferTiles);
        pixelBounds = new L.Bounds(pixelBounds.min.subtract(buffer), pixelBounds.max.add(buffer));
      }
      var tileRange = this._pxBoundsToTileRange(pixelBounds);
      if (!this._tileRange || !tileRange.equals(this._tileRange)) {
        this._tileRange = tileRange;
        this._addTilesFromCenterOut();
      }
    }
  });
  L.tileLayer.edgeBuffer = function (url, options) {
    return new L.TileLayer.EdgeBuffer(url, options);
  };
})();
