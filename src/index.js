/**
 * Created by jsinai on 10/24/16.
 */

var async = require('async');
var fs = require('fs');
var xml2js = require('xml2js');
var parser = new xml2js.Parser();
var request = require('request');
var CryptoJS = require("crypto-js");

module.exports = {
    asyncDownload: asyncDownload
};

/*
 params: syncSpecUrl, poolPath (no trailing slash)
 */
function asyncDownload(params, progressCallback, assetFetcherCallback) {

    var err = undefined;
    if (params) {
        if (!params.syncSpecUrl || !params.poolPath) {

            err = "params: syncSpecUrl, poolPath required";
            if (assetFetcherCallback) {
                assetFetcherCallback(
                    // -2=POOL_EVENT_ALL_FAILED
                    {event: -2, name: undefined, responseCode: -1, failureReason: err});
            } else {
                console.log(err);
            }
            return;
        }
    } else {

        err = "params is required";
        if (assetFetcherCallback) {
            assetFetcherCallback(
                // -2=POOL_EVENT_ALL_FAILED
                {event: -2, name: undefined, responseCode: -1, failureReason: err});
        } else {
            console.log(err);
        }
        return;
    }
    // Download the sync spec
    // The following is served by ez-asset-pool-server-with-sync-spec: 'http://10.0.1.13:1337/sync-spec.xml'
    request(params.syncSpecUrl, function (error, response, syncSpec) {
        if (error) {
            if (assetFetcherCallback) {
                assetFetcherCallback(
                    // -2=POOL_EVENT_ALL_FAILED
                    {event: -2, name: params.syncSpecUrl, responseCode: error.code, failureReason: error.message});
            } else {
                console.log(error.message);
            }
            return;
        }
        function formatBytes(bytes, decimals) {
            if (bytes == 0) {
                return '0 Bytes';
            }
            var k = 1000;
            var dm = decimals + 1 || 3;
            var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
            var i = Math.floor(Math.log(bytes) / Math.log(k));
            return (bytes / Math.pow(k, i)).toPrecision(dm) + ' ' + sizes[i];
        }

        function downloadFile(file, callback) {
            if (!(file && file.link && file.link.length > 0 && file.name && file.name.length > 0)) {
                var err = "Malformed sync spec";
                if (assetFetcherCallback) {
                    assetFetcherCallback(
                        // -1=POOL_EVENT_FILE_FAILED
                        {event: -1, name: filename, responseCode: -1, failureReason: err});
                } else {
                    console.log(err);
                }
                callback();
                return;
            }
            var link = file.link[0];
            var filename = file.name[0];
            var hash = undefined;
            var hashMethod = "sha1";
            if (file && file.hash && file.hash.length > 0 && file.hash[0]._) {
                // Hash is optional
                hash = file.hash[0]._;
                hashMethod =
                    (file.hash[0].$ && file.hash[0].$.method) ? file.hash[0].$.method.toLocaleLowerCase() : 'sha1';
            }
            var dest = params.poolPath + '/' + filename;
            var writer = fs.createWriteStream(dest);
            var sha1 = CryptoJS.algo.SHA1.create();

            var dlProgress = 0;
            // Download the file
            request(link, function (error, response) {
                if (error || response.statusCode != 200) {
                    // Deliberately don't call async's error callback so that we get a completion cb at the end
                    callback(
                        // -1=POOL_EVENT_FILE_FAILED
                        {event: -1, name: filename, failureReason: error});
                } else {
                    var finalized = sha1.finalize();
                    var dlHash = finalized.toString(CryptoJS.enc.Hex);
                    // TODO: test different hashMethods
                    if (hash && hash !== dlHash) {
                        writer.end();
                        writer.on('finish', function () {
                            writer.close(function () {
                                // Delete the file because the hash didn't match.
                                fs.unlink(dest, function () {
                                    callback({
                                        // -10007=ERROR_HASH_MISMATCH
                                        event: -10007,
                                        name: filename,
                                        failureReason: "A downloaded file did not match its checksum or file size"
                                    });
                                });
                            });
                        });
                    } else {
                        writer.end();
                        writer.on('finish', function () {
                            writer.close(function () {
                                // 1=POOL_EVENT_FILE_DOWNLOADED
                                if (progressCallback) {
                                    progressCallback({filename: filename, transferred: '100%'});
                                }
                                callback();
                            });
                        });
                    }
                }
            }).on('data', function (chunk) {
                sha1.update(chunk.toString());
                writer.write(chunk);
                dlProgress += chunk.length;
                var size = formatBytes(dlProgress, 2);
                if (progressCallback) {
                    progressCallback({filename: filename, transferred: size});
                }
            });
        }

        // If we successfully downloaded the sync spec, parse it.
        parser.parseString(syncSpec, function (err, result) {
            if (result && result.sync && result.sync.files && result.sync.files.length > 0 &&
                result.sync.files[0].download) {
                var files = result.sync.files[0].download;
                async.each(files, downloadFile,
                    function (err) {
                        if (err) {
                            if (assetFetcherCallback) {
                                assetFetcherCallback(err);
                            } else {
                                console.log(err);
                            }
                        } else {
                            // 2=POOL_EVENT_ALL_DOWNLOADED
                            if (assetFetcherCallback) {
                                assetFetcherCallback(
                                    {event: 2, name: params.syncSpecUrl, responseCode: response.statusCode});
                            }
                        }
                    });
            } else {
                err = "Malformed sync spec";
                if (assetFetcherCallback) {
                    assetFetcherCallback(
                        // -2=POOL_EVENT_ALL_FAILED
                        {event: -2, name: params.syncSpecUrl, responseCode: -1, failureReason: err});
                } else {
                    console.log(err);
                }
            }
        });
    });
};


