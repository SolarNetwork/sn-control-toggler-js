function mock(XMLHttpRequest) {

    var req = function request(url) {
        const xhr = new XMLHttpRequest();
        const headers = new Map();
        const events = new Map();
        const self = {};

        "onload" in xhr
            ? xhr.onload = xhr.onerror = xhr.ontimeout = respond
            : xhr.onreadystatechange = function(o) { xhr.readyState > 3 && respond(o); };


        function callEvent(name, arg) {
            const fns = events.get(name);
            if ( fns ) {
                fns.forEach((fn) => {
                    fn.call(self, arg);
                });
            }
        }
        
        function hasResponse(xhr) {
            var type = xhr.responseType;
            return type && type !== "text"
                ? xhr.response // null on error
                : xhr.responseText; // "" on error
        }
        
        function respond(o) {
            var status = xhr.status, result;
            if (!status && hasResponse(xhr)
                || status >= 200 && status < 300
                || status === 304) {
                result = xhr;
                callEvent("load", result);
            } else {
                callEvent("error", o);
            }
        }

        self.on = (name, cb) => {
            let handlers = events.get(name);
            if ( !handlers ) {
                handlers = [];
                events.set(name, handlers);
            }
            handlers.push(cb);
            return self;
        };
        
        self.mimeType = (type) => {
            headers.set('Accept', type);
            return self;
        };
        
        self.send = (method, data, cb) => {
            xhr.open(method, url);
            headers.forEach((v, k) => {
                xhr.setRequestHeader(k, v);
            });
            if ( cb ) {
                self.on("error", cb).on("load", (xhr) => cb(null, xhr));
            }
            callEvent('beforesend', xhr);
            xhr.send(data);
            return self;
        };

        return self;
    };

    return req;
}

export default mock;
