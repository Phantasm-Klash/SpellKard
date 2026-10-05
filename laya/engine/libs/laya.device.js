(function (exports, Laya) {
    'use strict';

    class Accelerator extends Laya.EventDispatcher {
        static get instance() {
            Accelerator._instance = Accelerator._instance || new Accelerator();
            return Accelerator._instance;
        }
        constructor() {
            super();
        }
        onStartListeningToType(type) {
            if (type === Laya.Event.CHANGE)
                Laya.PAL.device.on("devicemotion", this, this.onDeviceMotionChange);
            return this;
        }
        onDeviceMotionChange(acceleration, accelerationIncludingGravity, interval, rotationRate) {
            this.event(Laya.Event.CHANGE, [acceleration, accelerationIncludingGravity, rotationRate, interval]);
        }
        static getTransformedAcceleration(acceleration) {
            Accelerator.transformedAcceleration = Accelerator.transformedAcceleration || { x: 0, y: 0, z: 0 };
            Accelerator.transformedAcceleration.z = acceleration.z;
            let ot = Laya.PAL.browser.getScreenOrientation();
            if (ot === "landscape-primary") {
                Accelerator.transformedAcceleration.x = acceleration.y;
                Accelerator.transformedAcceleration.y = -acceleration.x;
            }
            else if (ot === "landscape-secondary") {
                Accelerator.transformedAcceleration.x = -acceleration.y;
                Accelerator.transformedAcceleration.y = acceleration.x;
            }
            else if (ot === "portrait-primary") {
                Accelerator.transformedAcceleration.x = acceleration.x;
                Accelerator.transformedAcceleration.y = acceleration.y;
            }
            else if (ot === "portrait-secondary") {
                Accelerator.transformedAcceleration.x = -acceleration.x;
                Accelerator.transformedAcceleration.y = -acceleration.y;
            }
            let tx;
            if (Laya.ILaya.stage.canvasDegree == -90) {
                tx = Accelerator.transformedAcceleration.x;
                Accelerator.transformedAcceleration.x = -Accelerator.transformedAcceleration.y;
                Accelerator.transformedAcceleration.y = tx;
            }
            else if (Laya.ILaya.stage.canvasDegree == 90) {
                tx = Accelerator.transformedAcceleration.x;
                Accelerator.transformedAcceleration.x = Accelerator.transformedAcceleration.y;
                Accelerator.transformedAcceleration.y = -tx;
            }
            return Accelerator.transformedAcceleration;
        }
    }

    class Shake extends Laya.EventDispatcher {
        static get instance() {
            Shake._instance = Shake._instance || new Shake();
            return Shake._instance;
        }
        start(threshold, interval) {
            this.threshold = threshold;
            this.shakeInterval = interval;
            this.lastX = this.lastY = this.lastZ = NaN;
            Accelerator.instance.on(Laya.Event.CHANGE, this, this.onShake);
        }
        stop() {
            Accelerator.instance.off(Laya.Event.CHANGE, this, this.onShake);
        }
        onShake(acceleration, accelerationIncludingGravity, rotationRate, interval) {
            if (isNaN(this.lastX)) {
                this.lastX = accelerationIncludingGravity.x;
                this.lastY = accelerationIncludingGravity.y;
                this.lastZ = accelerationIncludingGravity.z;
                this.lastMillSecond = performance.now();
                return;
            }
            let deltaX = Math.abs(this.lastX - accelerationIncludingGravity.x);
            let deltaY = Math.abs(this.lastY - accelerationIncludingGravity.y);
            let deltaZ = Math.abs(this.lastZ - accelerationIncludingGravity.z);
            if (this.isShaked(deltaX, deltaY, deltaZ)) {
                let deltaMillSecond = performance.now() - this.lastMillSecond;
                if (deltaMillSecond > this.shakeInterval) {
                    this.event(Laya.Event.CHANGE);
                    this.lastMillSecond = performance.now();
                }
            }
            this.lastX = accelerationIncludingGravity.x;
            this.lastY = accelerationIncludingGravity.y;
            this.lastZ = accelerationIncludingGravity.z;
        }
        isShaked(deltaX, deltaY, deltaZ) {
            const mask = (deltaX > this.threshold ? 1 : 0) |
                (deltaY > this.threshold ? 2 : 0) |
                (deltaZ > this.threshold ? 4 : 0);
            return (mask & (mask - 1)) !== 0;
        }
    }

    class WebDeviceAdapter extends Laya.DeviceAdapter {
        constructor() {
            var _a;
            super();
            this._locInfo = { timestamp: 0, accuracy: 0, altitude: 0, altitudeAccuracy: 0, heading: 0, latitude: 0, longitude: 0, speed: 0 };
            this._accInfo = { x: 0, y: 0, z: 0 };
            this._accInfo2 = Object.assign({}, this._accInfo);
            this._rotInfo = { alpha: 0, beta: 0, gamma: 0, absolute: false, compassAccuracy: 0 };
            this._rotInfo2 = Object.assign({}, this._rotInfo);
            let navigator = Laya.Browser.window.navigator;
            if (navigator) {
                this._loc = navigator.geolocation;
                this._getUserMedia = ((_a = navigator.mediaDevices) === null || _a === void 0 ? void 0 : _a.getUserMedia) || navigator.getUserMedia;
            }
        }
        get supportedLocation() {
            return !!this._loc;
        }
        get supportedGetUserMedia() {
            return !!this._getUserMedia;
        }
        getCurrentPosition(successCallback, errorCallback, options) {
            if (this._loc)
                this._loc.getCurrentPosition((pos) => {
                    Object.assign(this._locInfo, pos.coords);
                    this._locInfo.timestamp = pos.timestamp;
                    successCallback(this._locInfo);
                }, (error) => errorCallback === null || errorCallback === void 0 ? void 0 : errorCallback(error), options);
            else if (errorCallback)
                errorCallback(unsupportedError);
        }
        watchPosition(successCallback, errorCallback, options) {
            if (this._loc)
                return this._loc.watchPosition((pos) => {
                    Object.assign(this._locInfo, pos.coords);
                    this._locInfo.timestamp = pos.timestamp;
                    successCallback(this._locInfo);
                }, (error) => errorCallback === null || errorCallback === void 0 ? void 0 : errorCallback(error), options);
            else if (errorCallback) {
                errorCallback(unsupportedError);
                return -1;
            }
            else
                return -1;
        }
        clearWatchPosition(id) {
            if (this._loc)
                this._loc.clearWatch(id);
        }
        getUserMedia(constraints, successCallback, errorCallback) {
            if (this._getUserMedia) {
                this._getUserMedia(constraints).then(stream => successCallback(stream))
                    .catch((error) => errorCallback === null || errorCallback === void 0 ? void 0 : errorCallback(error));
            }
            else
                errorCallback === null || errorCallback === void 0 ? void 0 : errorCallback(new Error("getUserMedia is not supported."));
        }
        startListeningDeviceMotion() {
            Laya.Browser.window.addEventListener("devicemotion", e => this.onDeviceMotion(e));
        }
        startListeningDeviceOrientation() {
            Laya.Browser.window.addEventListener("deviceorientation", e => this.onDeviceOrientation(e));
        }
        onDeviceMotion(e) {
            this._accInfo.x = e.acceleration.x;
            this._accInfo.y = e.acceleration.y;
            this._accInfo.z = e.acceleration.z;
            this._accInfo2.x = e.accelerationIncludingGravity.x;
            this._accInfo2.y = e.accelerationIncludingGravity.y;
            this._accInfo2.z = e.accelerationIncludingGravity.z;
            this._rotInfo.alpha = e.rotationRate.gamma * -1;
            this._rotInfo.beta = e.rotationRate.alpha * -1;
            this._rotInfo.gamma = e.rotationRate.beta;
            e.interval;
            if (Laya.Browser.onAndroid) {
                if (Laya.Browser.userAgent.indexOf("Chrome") > -1) {
                    this._rotInfo.alpha *= 180 / Math.PI;
                    this._rotInfo.beta *= 180 / Math.PI;
                    this._rotInfo.gamma *= 180 / Math.PI;
                }
                this._accInfo.x *= -1;
                this._accInfo2.x *= -1;
            }
            else if (Laya.Browser.onIOS) {
                this._accInfo.y *= -1;
                this._accInfo.z *= -1;
                this._accInfo2.y *= -1;
                this._accInfo2.z *= -1;
            }
            this.event("devicemotion", [this._accInfo, this._accInfo2, this._rotInfo, e.interval]);
        }
        onDeviceOrientation(e) {
            this._rotInfo2.alpha = e.alpha;
            this._rotInfo2.beta = e.beta;
            this._rotInfo2.gamma = e.gamma;
            if (e.webkitCompassHeading) {
                this._rotInfo2.alpha = e.webkitCompassHeading * -1;
                this._rotInfo2.compassAccuracy = e.webkitCompassAccuracy;
            }
            this.event("deviceorientation", [e.absolute, this._rotInfo2]);
        }
    }
    const unsupportedError = { code: 9, message: "Geolocation is not supported." };
    Laya.PAL.register("device", WebDeviceAdapter);

    class Geolocation {
        static getCurrentPosition(onSuccess, onError) {
            Laya.PAL.device.getCurrentPosition(info => {
                if (onSuccess instanceof Laya.Handler)
                    onSuccess.runWith(info);
                else
                    onSuccess(info);
            }, err => {
                if (onError instanceof Laya.Handler)
                    onError.runWith(err);
                else if (onError)
                    onError(err);
            }, {
                enableHighAccuracy: Geolocation.enableHighAccuracy,
                timeout: Geolocation.timeout,
                maximumAge: Geolocation.maximumAge
            });
        }
        static watchPosition(onSuccess, onError) {
            return Laya.PAL.device.watchPosition(info => {
                if (onSuccess instanceof Laya.Handler)
                    onSuccess.runWith(info);
                else
                    onSuccess(info);
            }, err => {
                if (onError instanceof Laya.Handler)
                    onError.runWith(err);
                else if (onError)
                    onError(err);
            }, {
                enableHighAccuracy: Geolocation.enableHighAccuracy,
                timeout: Geolocation.timeout,
                maximumAge: Geolocation.maximumAge
            });
        }
        static clearWatch(id) {
            Laya.PAL.device.clearWatchPosition(id);
        }
    }
    Geolocation.PERMISSION_DENIED = 1;
    Geolocation.POSITION_UNAVAILABLE = 2;
    Geolocation.TIMEOUT = 3;
    Geolocation.enableHighAccuracy = false;
    Geolocation.timeout = 1E10;
    Geolocation.maximumAge = 0;

    class Media {
        static supported() {
            return Laya.PAL.device.supportedGetUserMedia;
        }
        static getMedia(constraints, onSuccess, onError) {
            Laya.PAL.device.getUserMedia(constraints, stream => {
                if (onSuccess instanceof Laya.Handler)
                    onSuccess.runWith(stream);
                else
                    onSuccess(stream);
            }, err => {
                if (onError instanceof Laya.Handler)
                    onError.runWith(err);
                else if (onError)
                    onError(err);
            });
        }
    }

    class Gyroscope extends Laya.EventDispatcher {
        static get instance() {
            Gyroscope._instance = Gyroscope._instance || new Gyroscope();
            return Gyroscope._instance;
        }
        onStartListeningToType(type) {
            if (type === Laya.Event.CHANGE)
                Laya.PAL.device.on("deviceorientation", this, this.onDeviceOrientation);
            return this;
        }
        onDeviceOrientation(absolute, orientationInfo) {
            this.event(Laya.Event.CHANGE, [absolute, orientationInfo]);
        }
    }

    exports.Accelerator = Accelerator;
    exports.Geolocation = Geolocation;
    exports.Gyroscope = Gyroscope;
    exports.Media = Media;
    exports.Shake = Shake;
    exports.WebDeviceAdapter = WebDeviceAdapter;

})(window.Laya = window.Laya || {}, Laya);
//# sourceMappingURL=laya.device.js.map
