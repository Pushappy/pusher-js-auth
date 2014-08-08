/**
 * Pusher plugin for batching auth requests in one HTTP call
 * Kudos @pl https://gist.github.com/pl/685c4766b58a238309e8
 *
 * Copyright 2014, Dirk Bonhomme <dirk@bytelogic.be>
 * Released under the MIT licence.
 */
(function(Pusher){

    /**
     * Buffered authorizer constructor
     */
    var BufferedAuthorizer = function(options){
        this.options = options;
        this.authOptions = options.authOptions || {};
        this.requests = {};
        this.setRequestTimeout();
    };

    /**
     * Add auth request to queue and execute after delay
     */
    BufferedAuthorizer.prototype.add = function(socketId, channel, callback){
        this.requests[socketId] = this.requests[socketId] || {};
        this.requests[socketId][channel] = callback;
        if(!this.requestTimeout){
            this.setRequestTimeout();
        }
    };

    /**
     * Set new delay and authenticate all queued requests after timeout
     */
    BufferedAuthorizer.prototype.setRequestTimeout = function(){
        clearTimeout(this.requestTimeout);
        this.requestTimeout = setTimeout(function(){
            if(Pusher.Util.keys(this.requests).length){
                this.executeRequests();
                this.setRequestTimeout();
            }else{
                this.requestTimeout = null;
            }
        }.bind(this), this.options.authDelay || 0);
    };

    /**
     * Compose POST query
     *
     * @notice Override of original method signature by replacing socketId with requests argument
     */
    BufferedAuthorizer.prototype.composeQuery = function(socketInfo){
        var i = 0, query = '&socket_id=' + encodeURIComponent(socketInfo.socketId);
        for(var channel in socketInfo.channels){
            query += '&channel_name[' + i + ']=' + encodeURIComponent(channel);
            i++;
        }
        for(var param in this.authOptions.params) {
            query += '&' + encodeURIComponent(param) + '=' + encodeURIComponent(this.authOptions.params[param]);
        }
        return query;
    };

    /**
     * Execute all queued auth requests for the first socketId
     */
    BufferedAuthorizer.prototype.executeRequests = function(){
        // normal use-case involves a single socketId, so pop off. However, this allows to processing multiple socketIds if needed.
        var socketId = Pusher.Util.keys(this.requests)[0];
        var socketInfo = {socketId: socketId, channels: this.requests[socketId]};
        delete this.requests[socketId];
        Pusher.authorizers.ajax.call(this, socketInfo, function(error, response){
            if(error){
                Pusher.Util.objectApply(socketInfo.channels, function(callback){
                    callback(true, response);
                });
            }else{
                Pusher.Util.objectApply(socketInfo.channels, function(callback, channel){
                    if(response[socketId] && response[socketId][channel]){
                        if(!response[socketId][channel].status || response[socketId][channel].status === 200){
                            callback(null, response[socketId][channel].data); // successful authentication
                        }else{
                            callback(true, response[socketId][channel].status); // authentication failed
                        }
                    }else{
                        callback(true, 404); // authentication data for this channel not returned
                    }
                });
            }
        });
    };

    /**
     * Add buffered authorizer to Pusher lib
     * Each endpoint gets its own buffered authorizer
     */
    var authorizers = {};
    Pusher.authorizers.buffered = function(socketId, callback){
        var authEndpoint = this.options.authEndpoint;
        var authorizer = authorizers[authEndpoint];
        if(!authorizer){
            authorizer = authorizers[authEndpoint] = new BufferedAuthorizer({
                authEndpoint: authEndpoint,
                authDelay: this.options.authDelay,
                authOptions: this.options.auth
            });
        }
        authorizer.add(socketId, this.channel.name, callback);
    };

})(window.Pusher);