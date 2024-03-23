  'use strict';

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
    
    var canvas = document.getElementsByTagName('canvas')[0];
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    
    var params = { alpha: false, depth: false, stencil: false, antialias: false };
    var gl = canvas.getContext('webgl2', params);
    var isWebGL2 = !!gl;
    if (!isWebGL2) {
        gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);
    }
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    
    var halfFloat = gl.getExtension('OES_texture_half_float');
    var support_linear_float = gl.getExtension('OES_texture_half_float_linear');
    if (isWebGL2) {
        gl.getExtension('EXT_color_buffer_float');
        support_linear_float = gl.getExtension('OES_texture_float_linear');
    }
    
    var TEXTURE_DOWNSAMPLE = 1;
    var DENSITY_DISSIPATION = 0.98;
    var VELOCITY_DISSIPATION = 0.99;
    var SPLAT_RADIUS = 0.005;
    var CURL = 30;
    var PRESSURE_ITERATIONS = 25;
    
    var GLProgram = function () {
        function GLProgram(vertexShader, fragmentShader) {
            _classCallCheck(this, GLProgram);
    
            this.uniforms = {};
            this.program = gl.createProgram();
    
            gl.attachShader(this.program, vertexShader);
            gl.attachShader(this.program, fragmentShader);
            gl.linkProgram(this.program);
    
            if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw gl.getProgramInfoLog(this.program);
    
            var uniformCount = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS);
            for (var i = 0; i < uniformCount; i++) {
                var uniformName = gl.getActiveUniform(this.program, i).name;
                this.uniforms[uniformName] = gl.getUniformLocation(this.program, uniformName);
            }
        }
    
        GLProgram.prototype.bind = function bind() {
            gl.useProgram(this.program);
        };
    
        return GLProgram;
    }();
    
    function compileShader(type, source) {
        var shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
    
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(shader);
    
        return shader;
    };
    
    var baseVertexShader = compileShader(gl.VERTEX_SHADER, '\n    precision highp float;\n    precision mediump sampler2D;\n\n    attribute vec2 aPosition;\n    varying vec2 vUv;\n    varying vec2 vL;\n    varying vec2 vR;\n    varying vec2 vT;\n    varying vec2 vB;\n    uniform vec2 texelSize;\n\n    void main () {\n        vUv = aPosition * 0.5 + 0.5;\n        vL = vUv - vec2(texelSize.x, 0.0);\n        vR = vUv + vec2(texelSize.x, 0.0);\n        vT = vUv + vec2(0.0, texelSize.y);\n        vB = vUv - vec2(0.0, texelSize.y);\n        gl_Position = vec4(aPosition, 0.0, 1.0);\n    }\n');
    
    var displayShader = compileShader(gl.FRAGMENT_SHADER, '\n    precision highp float;\n    precision mediump sampler2D;\n\n    varying vec2 vUv;\n    varying vec2 vL;\n    varying vec2 vR;\n    varying vec2 vT;\n    varying vec2 vB;\n    uniform sampler2D uTexture;\n\n    void main () {\n        gl_FragColor = texture2D(uTexture, vUv);\n    }\n');
    
    var splatShader = compileShader(gl.FRAGMENT_SHADER, '\n    precision highp float;\n    precision mediump sampler2D;\n\n    varying vec2 vUv;\n    uniform sampler2D uTarget;\n    uniform float aspectRatio;\n    uniform vec3 color;\n    uniform vec2 point;\n    uniform float radius;\n\n    void main () {\n        vec2 p = vUv - point.xy;\n        p.x *= aspectRatio;\n        vec3 splat = exp(-dot(p, p) / radius) * color;\n        vec3 base = texture2D(uTarget, vUv).xyz;\n        gl_FragColor = vec4(base + splat, 1.0);\n    }\n');
    
    var advectionManualFilteringShader = compileShader(gl.FRAGMENT_SHADER, '\n    precision highp float;\n    precision mediump sampler2D;\n\n    varying vec2 vUv;\n    uniform sampler2D uVelocity;\n    uniform sampler2D uSource;\n    uniform vec2 texelSize;\n    uniform float dt;\n    uniform float dissipation;\n\n    vec4 bilerp (in sampler2D sam, in vec2 p) {\n        vec4 st;\n        st.xy = floor(p - 0.5) + 0.5;\n        st.zw = st.xy + 1.0;\n        vec4 uv = st * texelSize.xyxy;\n        vec4 a = texture2D(sam, uv.xy);\n        vec4 b = texture2D(sam, uv.zy);\n        vec4 c = texture2D(sam, uv.xw);\n        vec4 d = texture2D(sam, uv.zw);\n        vec2 f = p - st.xy;\n        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);\n    }\n\n    void main () {\n        vec2 coord = gl_FragCoord.xy - dt * texture2D(uVelocity, vUv).xy;\n        gl_FragColor = dissipation * bilerp(uSource, coord);\n        gl_FragColor.a = 1.0;\n    }\n');
    
    var advectionShader = compileShader(gl.FRAGMENT_SHADER, '\n    precision highp float;\n    precision mediump sampler2D;\n\n    varying vec2 vUv;\n    uniform sampler2D uVelocity;\n    uniform sampler2D uSource;\n    uniform vec2 texelSize;\n    uniform float dt;\n    uniform float dissipation;\n\n    void main () {\n        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;\n        gl_FragColor = dissipation * texture2D(uSource, coord);\n    }\n');
    
    var divergenceShader = compileShader(gl.FRAGMENT_SHADER, '\n    precision highp float;\n    precision mediump sampler2D;\n\n    varying vec2 vUv;\n    varying vec2 vL;\n    varying vec2 vR;\n    varying vec2 vT;\n    varying vec2 vB;\n    uniform sampler2D uVelocity;\n\n    vec2 sampleVelocity (in vec2 uv) {\n        vec2 multiplier = vec2(1.0, 1.0);\n        if (uv.x < 0.0) { uv.x = 0.0; multiplier.x = -1.0; }\n        if (uv.x > 1.0) { uv.x = 1.0; multiplier.x = -1.0; }\n        if (uv.y < 0.0) { uv.y = 0.0; multiplier.y = -1.0; }\n        if (uv.y > 1.0) { uv.y = 1.0; multiplier.y = -1.0; }\n        return multiplier * texture2D(uVelocity, uv).xy;\n    }\n\n    void main () {\n        float L = sampleVelocity(vL).x;\n        float R = sampleVelocity(vR).x;\n        float T = sampleVelocity(vT).y;\n        float B = sampleVelocity(vB).y;\n        float div = 0.5 * (R - L + T - B);\n        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);\n    }\n');
    
    var curlShader = compileShader(gl.FRAGMENT_SHADER, '\n    precision highp float;\n    precision mediump sampler2D;\n\n    varying vec2 vUv;\n    varying vec2 vL;\n    varying vec2 vR;\n    varying vec2 vT;\n    varying vec2 vB;\n    uniform sampler2D uVelocity;\n\n    void main () {\n        float L = texture2D(uVelocity, vL).y;\n        float R = texture2D(uVelocity, vR).y;\n        float T = texture2D(uVelocity, vT).x;\n        float B = texture2D(uVelocity, vB).x;\n        float vorticity = R - L - T + B;\n        gl_FragColor = vec4(vorticity, 0.0, 0.0, 1.0);\n    }\n');
    
    var vorticityShader = compileShader(gl.FRAGMENT_SHADER, '\n    precision highp float;\n    precision mediump sampler2D;\n\n    varying vec2 vUv;\n    varying vec2 vL;\n    varying vec2 vR;\n    varying vec2 vT;\n    varying vec2 vB;\n    uniform sampler2D uVelocity;\n    uniform sampler2D uCurl;\n    uniform float curl;\n    uniform float dt;\n\n    void main () {\n        float L = texture2D(uCurl, vL).y;\n        float R = texture2D(uCurl, vR).y;\n        float T = texture2D(uCurl, vT).x;\n        float B = texture2D(uCurl, vB).x;\n        float C = texture2D(uCurl, vUv).x;\n        vec2 force = vec2(abs(T) - abs(B), abs(R) - abs(L));\n        force *= 1.0 / length(force + 0.00001) * curl * C;\n        vec2 vel = texture2D(uVelocity, vUv).xy;\n        gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);\n    }\n');
    
    var pressureShader = compileShader(gl.FRAGMENT_SHADER, '\n    precision highp float;\n    precision mediump sampler2D;\n\n    varying vec2 vUv;\n    varying vec2 vL;\n    varying vec2 vR;\n    varying vec2 vT;\n    varying vec2 vB;\n    uniform sampler2D uPressure;\n    uniform sampler2D uDivergence;\n\n    vec2 boundary (in vec2 uv) {\n        uv = min(max(uv, 0.0), 1.0);\n        return uv;\n    }\n\n    void main () {\n        float L = texture2D(uPressure, boundary(vL)).x;\n        float R = texture2D(uPressure, boundary(vR)).x;\n        float T = texture2D(uPressure, boundary(vT)).x;\n        float B = texture2D(uPressure, boundary(vB)).x;\n        float C = texture2D(uPressure, vUv).x;\n        float divergence = texture2D(uDivergence, vUv).x;\n        float pressure = (L + R + B + T - divergence) * 0.25;\n        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);\n    }\n');
    
    var gradientSubtractShader = compileShader(gl.FRAGMENT_SHADER, '\n    precision highp float;\n    precision mediump sampler2D;\n\n    varying vec2 vUv;\n    varying vec2 vL;\n    varying vec2 vR;\n    varying vec2 vT;\n    varying vec2 vB;\n    uniform sampler2D uPressure;\n    uniform sampler2D uVelocity;\n\n    vec2 boundary (in vec2 uv) {\n        uv = min(max(uv, 0.0), 1.0);\n        return uv;\n    }\n\n    void main () {\n        float L = texture2D(uPressure, boundary(vL)).x;\n        float R = texture2D(uPressure, boundary(vR)).x;\n        float T = texture2D(uPressure, boundary(vT)).x;\n        float B = texture2D(uPressure, boundary(vB)).x;\n        vec2 velocity = texture2D(uVelocity, vUv).xy;\n        velocity.xy -= vec2(R - L, T - B);\n        gl_FragColor = vec4(velocity, 0.0, 1.0);\n    }\n');
    
    var blit = function () {
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);
    
        return function (destination) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
            gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        };
    }();
    
    function clear(target) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }
    
    function createFBO(texId, w, h, internalFormat, format, type, param) {
        gl.activeTexture(gl.TEXTURE0 + texId);
        var texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    
        var fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.viewport(0, 0, w, h);
        gl.clear(gl.COLOR_BUFFER_BIT);
    
        return [texture, fbo, texId];
    }
    
    function createDoubleFBO(texId, w, h, internalFormat, format, type, param) {
        var fbo1 = createFBO(texId, w, h, internalFormat, format, type, param);
        var fbo2 = createFBO(texId + 1, w, h, internalFormat, format, type, param);
    
        return {
            get first() {
                return fbo1;
            },
            get second() {
                return fbo2;
            },
            swap: function swap() {
                var temp = fbo1;
                fbo1 = fbo2;
                fbo2 = temp;
            }
        };
    }
    
    var textureWidth = undefined;
    var textureHeight = undefined;
    var density = undefined;
    var velocity = undefined;
    var divergence = undefined;
    var curl = undefined;
    var pressure = undefined;
    
    function initFramebuffers() {
        textureWidth = gl.drawingBufferWidth >> TEXTURE_DOWNSAMPLE;
        textureHeight = gl.drawingBufferHeight >> TEXTURE_DOWNSAMPLE;
    
        var internalFormat = isWebGL2 ? gl.RGBA16F : gl.RGBA;
        var internalFormatRG = isWebGL2 ? gl.RG16F : gl.RGBA;
        var formatRG = isWebGL2 ? gl.RG : gl.RGBA;
        var texType = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES;
    
        density = createDoubleFBO(0, textureWidth, textureHeight, internalFormat, gl.RGBA, texType, support_linear_float ? gl.LINEAR : gl.NEAREST);
        velocity = createDoubleFBO(2, textureWidth, textureHeight, internalFormatRG, formatRG, texType, support_linear_float ? gl.LINEAR : gl.NEAREST);
        divergence = createFBO(4, textureWidth, textureHeight, internalFormatRG, formatRG, texType, gl.NEAREST);
        curl = createFBO(5, textureWidth, textureHeight, internalFormatRG, formatRG, texType, gl.NEAREST);
        pressure = createDoubleFBO(6, textureWidth, textureHeight, internalFormatRG, formatRG, texType, gl.NEAREST);
    }
    
    initFramebuffers();
    
    var displayProgram = new GLProgram(baseVertexShader, displayShader);
    var splatProgram = new GLProgram(baseVertexShader, splatShader);
    var advectionProgram = new GLProgram(baseVertexShader, support_linear_float ? advectionShader : advectionManualFilteringShader);
    var divergenceProgram = new GLProgram(baseVertexShader, divergenceShader);
    var curlProgram = new GLProgram(baseVertexShader, curlShader);
    var vorticityProgram = new GLProgram(baseVertexShader, vorticityShader);
    var pressureProgram = new GLProgram(baseVertexShader, pressureShader);
    var gradienSubtractProgram = new GLProgram(baseVertexShader, gradientSubtractShader);
    
    function pointerPrototype() {
        this.id = -1;
        this.x = 0;
        this.y = 0;
        this.dx = 0;
        this.dy = 0;
        this.down = false;
        this.moved = false;
        this.color = [30, 0, 300];
    }
    
    var pointers = [];
    pointers.push(new pointerPrototype());
    
    for (var i = 0; i < 10; i++) {
        var color = [Math.random() * 10, Math.random() * 10, Math.random() * 10];
        var x = canvas.width * Math.random();
        var y = canvas.height * Math.random();
        var dx = 1000 * (Math.random() - 0.5);
        var dy = 1000 * (Math.random() - 0.5);
        splat(x, y, dx, dy, color);
    }
    
    var lastTime = Date.now();
    Update();
    
    function Update() {
        resizeCanvas();
    
        var dt = Math.min((Date.now() - lastTime) / 1000, 0.016);
        lastTime = Date.now();
    
        gl.viewport(0, 0, textureWidth, textureHeight);
    
        advectionProgram.bind();
        gl.uniform2f(advectionProgram.uniforms.texelSize, 1.0 / textureWidth, 1.0 / textureHeight);
        gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.first[2]);
        gl.uniform1i(advectionProgram.uniforms.uSource, velocity.first[2]);
        gl.uniform1f(advectionProgram.uniforms.dt, dt);
        gl.uniform1f(advectionProgram.uniforms.dissipation, VELOCITY_DISSIPATION);
        blit(velocity.second[1]);
        velocity.swap();
    
        gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.first[2]);
        gl.uniform1i(advectionProgram.uniforms.uSource, density.first[2]);
        gl.uniform1f(advectionProgram.uniforms.dissipation, DENSITY_DISSIPATION);
        blit(density.second[1]);
        density.swap();
    
        for (var i = 0; i < pointers.length; i++) {
            var pointer = pointers[i];
            if (pointer.moved) {
                splat(pointer.x, pointer.y, pointer.dx, pointer.dy, pointer.color);
                pointer.moved = false;
            }
        }
    
        curlProgram.bind();
        gl.uniform2f(curlProgram.uniforms.texelSize, 1.0 / textureWidth, 1.0 / textureHeight);
        gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.first[2]);
        blit(curl[1]);
    
        vorticityProgram.bind();
        gl.uniform2f(vorticityProgram.uniforms.texelSize, 1.0 / textureWidth, 1.0 / textureHeight);
        gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.first[2]);
        gl.uniform1i(vorticityProgram.uniforms.uCurl, curl[2]);
        gl.uniform1f(vorticityProgram.uniforms.curl, CURL);
        gl.uniform1f(vorticityProgram.uniforms.dt, dt);
        blit(velocity.second[1]);
        velocity.swap();
    
        divergenceProgram.bind();
        gl.uniform2f(divergenceProgram.uniforms.texelSize, 1.0 / textureWidth, 1.0 / textureHeight);
        gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.first[2]);
        blit(divergence[1]);
    
        clear(pressure.first[1]);
        pressureProgram.bind();
        gl.uniform2f(pressureProgram.uniforms.texelSize, 1.0 / textureWidth, 1.0 / textureHeight);
        gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence[2]);
        for (var i = 0; i < PRESSURE_ITERATIONS; i++) {
            gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.first[2]);
            blit(pressure.second[1]);
            pressure.swap();
        }
    
        gradienSubtractProgram.bind();
        gl.uniform2f(gradienSubtractProgram.uniforms.texelSize, 1.0 / textureWidth, 1.0 / textureHeight);
        gl.uniform1i(gradienSubtractProgram.uniforms.uPressure, pressure.first[2]);
        gl.uniform1i(gradienSubtractProgram.uniforms.uVelocity, velocity.first[2]);
        blit(velocity.second[1]);
        velocity.swap();
    
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        displayProgram.bind();
        gl.uniform1i(displayProgram.uniforms.uTexture, density.first[2]);
        blit(null);
    
        requestAnimationFrame(Update);
    }
    
    function splat(x, y, dx, dy, color) {
        splatProgram.bind();
        gl.uniform1i(splatProgram.uniforms.uTarget, velocity.first[2]);
        gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
        gl.uniform2f(splatProgram.uniforms.point, x / canvas.width, 1.0 - y / canvas.height);
        gl.uniform3f(splatProgram.uniforms.color, dx, -dy, 1.0);
        gl.uniform1f(splatProgram.uniforms.radius, SPLAT_RADIUS);
        blit(velocity.second[1]);
        velocity.swap();
    
        gl.uniform1i(splatProgram.uniforms.uTarget, density.first[2]);
        gl.uniform3f(splatProgram.uniforms.color, color[0] * 0.3, color[1] * 0.3, color[2] * 0.3);
        blit(density.second[1]);
        density.swap();
    }
    
    function resizeCanvas() {
        if (canvas.width != canvas.clientWidth || canvas.height != canvas.clientHeight) {
            canvas.width = canvas.clientWidth;
            canvas.height = canvas.clientHeight;
            initFramebuffers();
        }
    }
    
    canvas.addEventListener('mousemove', function (e) {
        pointers[0].moved = pointers[0].down;
        pointers[0].dx = (e.offsetX - pointers[0].x) * 10.0;
        pointers[0].dy = (e.offsetY - pointers[0].y) * 10.0;
        pointers[0].x = e.offsetX;
        pointers[0].y = e.offsetY;
        pointers[0].down = true;
    });
    
    canvas.addEventListener('touchmove', function (e) {
        e.preventDefault();
        var touches = e.targetTouches;
        for (var i = 0; i < e.touches.length; i++) {
            var pointer = pointers[i];
            pointer.moved = pointer.down;
            pointer.dx = (touches[i].pageX - pointer.x) * 10.0;
            pointer.dy = (touches[i].pageY - pointer.y) * 10.0;
            pointer.x = touches[i].pageX;
            pointer.y = touches[i].pageY;
        }
    }, false);

