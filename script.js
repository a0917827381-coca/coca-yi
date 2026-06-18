// --- 1. 初始化 Matter.js 模組 ---
const { Engine, World, Bodies, Body, Composite } = Matter;
const engine = Engine.create({ gravity: { x: 0, y: 0 } }); 
const NORMAL_TIME_SCALE = 0.8; 
engine.timing.timeScale = NORMAL_TIME_SCALE;

// --- 2. 畫布與變數設定 ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = 800;
canvas.height = 800;

const ARENA_CENTER = { x: 400, y: 400 };
const ARENA_RADIUS = 380; 

let baguaData = null;
const baguaKeys = ["乾", "坤", "震", "巽", "坎", "離", "艮", "兌"];

// 狀態機與玩家狀態包 (將 isFallen 改為 isShattered 碎裂狀態)
let p1State = { upper: null, lower: null, currentUpper: "", currentLower: "", body: null, isShattered: false };
let p2State = { upper: null, lower: null, currentUpper: "", currentLower: "", body: null, isShattered: false };
let gameState = "wait"; 

let isTimeFrozen = false;
let freezeTarget = null;
let freezeText = "";
let freezeAlpha = 1.0;

// 特效變數
let particles = []; // 儲存碎裂粒子的陣列
let screenShake = 0; // 螢幕震動強度

// --- 3. 非同步載入八卦 JSON ---
fetch('bagua.json')
    .then(response => response.json())
    .then(data => {
        baguaData = data;
        initGame();
    })
    .catch(err => console.error("無法讀取卦象設定檔", err));

function initGame() {
    const wallOptions = { isStatic: true, render: { visible: false } };
    World.add(engine.world, [
        Bodies.rectangle(400, -10, 800, 20, wallOptions),
        Bodies.rectangle(400, 810, 800, 20, wallOptions),
        Bodies.rectangle(-10, 400, 20, 800, wallOptions),
        Bodies.rectangle(810, 400, 20, 800, wallOptions)
    ]);
    setupCollisionListener();
    requestAnimationFrame(drawGame);
}

// --- 4. 點擊監聽控制 ---
canvas.addEventListener('pointerdown', (e) => {
    if (!baguaData) return;

    if (gameState === "p1_win" || gameState === "p2_win") {
        gameState = "wait";
        p1State.upper = null; p1State.lower = null;
        p2State.upper = null; p2State.lower = null;
        particles = []; // 清空殘留粒子
        return; 
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    if (mouseY < 400) {
        handlePlayerInput(p1State, 400, 150, "P1"); 
    } else {
        handlePlayerInput(p2State, 400, 650, "P2"); 
    }
});

function handlePlayerInput(player, spawnX, spawnY, label) {
    if (player.body && !player.isShattered) return; 

    const randomGua = baguaKeys[Math.floor(Math.random() * baguaKeys.length)];
    if (!player.upper) {
        player.upper = randomGua;
    } else if (!player.lower) {
        player.lower = randomGua;
        spawnTop(player, spawnX, spawnY, label);
    }
}

function spawnTop(player, x, y, label) {
    if (player.body && player.isShattered) {
        World.remove(engine.world, player.body);
    }

    const up = baguaData[player.upper].upper;
    const lo = baguaData[player.lower].lower;
    const radius = 85; // 【視覺升級】尺寸放大近兩倍，極致張力

    let topBody;
    if (up.sides === 0) {
        topBody = Bodies.circle(x, y, radius, { label: label });
    } else {
        topBody = Bodies.polygon(x, y, up.sides, radius, { label: label });
    }

    Body.setMass(topBody, lo.mass * 2.0); 
    topBody.restitution = Math.max(lo.restitution + 0.3, 0.9); 
    topBody.friction = 0.01; 
    topBody.frictionAir = up.frictionAir * 0.15; 

    Body.setAngularVelocity(topBody, up.angularVelocity * 3.5); 
    
    const angleToCenter = Math.atan2(ARENA_CENTER.y - y, ARENA_CENTER.x - x);
    Body.setVelocity(topBody, {
        x: Math.cos(angleToCenter) * 10, 
        y: Math.sin(angleToCenter) * 10
    });

    player.body = topBody;
    player.currentUpper = player.upper;
    player.currentLower = player.lower;
    player.isShattered = false;

    World.add(engine.world, topBody);

    if (p1State.body && !p1State.isShattered && p2State.body && !p2State.isShattered) {
        gameState = "battle";
    }
}

// --- 5. 特效系統：產生碎裂粒子 ---
function createShatterEffect(x, y, colorStr) {
    screenShake = 35; // 觸發強烈螢幕震動
    for (let i = 0; i < 80; i++) {
        particles.push({
            x: x, y: y,
            vx: (Math.random() - 0.5) * 35, // 爆炸擴散速度
            vy: (Math.random() - 0.5) * 35,
            size: Math.random() * 18 + 4,
            color: colorStr,
            life: 1.0,
            decay: Math.random() * 0.02 + 0.015,
            angle: Math.random() * Math.PI * 2,
            vAngle: (Math.random() - 0.5) * 0.8,
            type: Math.random() > 0.6 ? 'spark' : 'shard' // 區分火花與實體碎片
        });
    }
}

function updateAndDrawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.vAngle;
        p.life -= p.decay;
        
        // 增加空氣阻力讓碎片稍微減速
        p.vx *= 0.92;
        p.vy *= 0.92;

        if (p.life <= 0) {
            particles.splice(i, 1);
            continue;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.globalAlpha = p.life;

        if (p.type === 'spark') {
            ctx.fillStyle = "#ffcc00"; // 明亮的火花
            ctx.globalCompositeOperation = "lighter";
            ctx.beginPath(); ctx.arc(0, 0, p.size * 0.4, 0, Math.PI * 2); ctx.fill();
        } else {
            ctx.fillStyle = p.color; // 本體顏色的幾何碎片
            ctx.beginPath();
            ctx.moveTo(0, -p.size);
            ctx.lineTo(p.size, p.size);
            ctx.lineTo(-p.size, p.size);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    }
}

// --- 6. 碰撞事件與時空凝結 ---
function setupCollisionListener() {
    Matter.Events.on(engine, 'collisionStart', (event) => {
        if (isTimeFrozen || gameState !== "battle") return;

        event.pairs.forEach(pair => {
            const labelA = pair.bodyA.label;
            const labelB = pair.bodyB.label;

            if ((labelA === "P1" || labelA === "P2") && (labelB === "P1" || labelB === "P2")) {
                const speed = pair.collision.speed || 4;
                const impulse = pair.collision.depth * speed;

                if (impulse > 2.5) { 
                    screenShake = 8; // 劇烈碰撞時給予小震動
                    const targetBody = Math.random() > 0.5 ? pair.bodyA : pair.bodyB;
                    const targetState = (targetBody.label === "P1") ? p1State : p2State;
                    if (!targetState.isShattered) {
                        const nextGua = baguaKeys[Math.floor(Math.random() * baguaKeys.length)];
                        startTimeFreeze(targetBody, nextGua);
                    }
                }
            }
        });
    });
}

function startTimeFreeze(body, nextGua) {
    isTimeFrozen = true;
    freezeTarget = body;
    freezeAlpha = 1.0;
    freezeText = `${body.label} 爻動 ➔ 突變【${nextGua}】卦！`;

    engine.timing.timeScale = 0.02; 

    setTimeout(() => {
        engine.timing.timeScale = NORMAL_TIME_SCALE; 
        isTimeFrozen = false;
        applyThrustVector(body, nextGua);
        freezeTarget = null;
    }, 600); 
}

function applyThrustVector(body, newGua) {
    const pState = (body.label === "P1") ? p1State : p2State;
    const oppState = (body.label === "P1") ? p2State : p1State;
    if (!oppState.body) return;

    pState.currentUpper = newGua; 

    const opponent = oppState.body;
    const vectorToOpp = Matter.Vector.sub(opponent.position, body.position);
    const normDir = Matter.Vector.normalise(vectorToOpp);

    switch (newGua) {
        case "震": 
            Body.setVelocity(body, Matter.Vector.mult(normDir, 16));
            Body.setAngularVelocity(body, 0.6); break;
        case "離": 
            const randomAngle = Math.random() * Math.PI * 2;
            Body.setVelocity(body, { x: Math.cos(randomAngle) * 12, y: Math.sin(randomAngle) * 12 });
            Body.setVelocity(opponent, Matter.Vector.mult(normDir, 10)); break;
        case "艮": 
            Body.setVelocity(body, { x: 0, y: 0 });
            Body.setMass(body, body.mass * 4); break;
        case "巽": 
            Body.setAngularVelocity(body, 0.7);
            body.frictionAir = 0.00001; break;
        default: 
            Body.setVelocity(body, Matter.Vector.mult(normDir, -8)); break;
    }
}

// --- 7. 生存判定：改為「觸碰邊界」或「力竭」直接觸發崩解碎裂 ---
function checkSurvival(player) {
    if (!player.body) return;

    const pos = player.body.position;
    const distance = Math.hypot(pos.x - ARENA_CENTER.x, pos.y - ARENA_CENTER.y);
    
    // 【全新死亡機制】碰觸到邊緣虛空區 (大於競技場半徑減去一點容錯) 就判定碎裂
    let isOut = distance > (ARENA_RADIUS - 40);
    let isStopped = false;

    if (gameState === "battle" && p1State.body && p2State.body && !player.isShattered) {
        if (Math.abs(player.body.angularVelocity) < 0.005 && player.body.speed < 0.2) {
            isStopped = true;
        }
    }

    if (gameState === "battle" && (isOut || isStopped)) {
        gameState = "ending";
        const winnerObj = (player === p1State) ? p2State : p1State;
        const loserObj = player;
        const winResult = (player === p1State) ? "p2_win" : "p1_win";

        // 【處決敗者：華麗碎裂】
        loserObj.isShattered = true;
        const colorStr = (loserObj === p1State) ? "#c0392b" : "#2980b9";
        createShatterEffect(loserObj.body.position.x, loserObj.body.position.y, colorStr);
        World.remove(engine.world, loserObj.body); // 徹底抹除實體，不再留屍體
        loserObj.body = null;

        // 【強化勝者】移除阻力，無限自轉
        if (winnerObj.body) {
            winnerObj.body.frictionAir = 0;
            winnerObj.body.friction = 0;
        }

        setTimeout(() => { gameState = winResult; }, 3000);
    }
}

// --- 8. 渲染引擎 ---
function drawGame() {
    Engine.update(engine, 1000 / 60);

    if (!isTimeFrozen) {
        checkSurvival(p1State);
        checkSurvival(p2State);
    }

    if (gameState === "ending" || gameState === "p1_win" || gameState === "p2_win") {
        if (p1State.body && !p1State.isShattered) Matter.Body.setAngularVelocity(p1State.body, 0.4);
        if (p2State.body && !p2State.isShattered) Matter.Body.setAngularVelocity(p2State.body, 0.4);
    }

    ctx.save(); // 保存未震動前的狀態

    // 【套用螢幕震動】
    if (screenShake > 0) {
        ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
        screenShake *= 0.85; // 每幀衰減
        if (screenShake < 0.5) screenShake = 0;
    }

    if (isTimeFrozen) {
        ctx.fillStyle = "#0a0a0a"; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let arenaGradient = ctx.createRadialGradient(
            ARENA_CENTER.x, ARENA_CENTER.y, ARENA_RADIUS * 0.8, ARENA_CENTER.x, ARENA_CENTER.y, ARENA_RADIUS
        );
        arenaGradient.addColorStop(0, "rgba(255,255,255,0)");
        arenaGradient.addColorStop(1, "rgba(0,0,0,0.6)"); 

        ctx.beginPath(); ctx.arc(ARENA_CENTER.x, ARENA_CENTER.y, ARENA_RADIUS, -Math.PI/2, Math.PI/2);
        ctx.fillStyle = "#e0e0e0"; ctx.fill();
        ctx.beginPath(); ctx.arc(ARENA_CENTER.x, ARENA_CENTER.y, ARENA_RADIUS, Math.PI/2, -Math.PI/2);
        ctx.fillStyle = "#333333"; ctx.fill();
        ctx.beginPath(); ctx.arc(ARENA_CENTER.x, ARENA_CENTER.y - ARENA_RADIUS/2, ARENA_RADIUS/2, 0, Math.PI*2);
        ctx.fillStyle = "#333333"; ctx.fill();
        ctx.beginPath(); ctx.arc(ARENA_CENTER.x, ARENA_CENTER.y + ARENA_RADIUS/2, ARENA_RADIUS/2, 0, Math.PI*2);
        ctx.fillStyle = "#e0e0e0"; ctx.fill();
        ctx.beginPath(); ctx.arc(ARENA_CENTER.x, ARENA_CENTER.y, ARENA_RADIUS, 0, Math.PI*2);
        ctx.fillStyle = arenaGradient; ctx.fill();
    }

    // 繪製陀螺實體
    const bodies = Composite.allBodies(engine.world);
    bodies.forEach(body => {
        if (body.isStatic) return; 

        ctx.save();
        ctx.translate(body.position.x, body.position.y);
        ctx.rotate(body.angle);

        const pState = (body.label === "P1") ? p1State : p2State;

        ctx.beginPath();
        body.vertices.forEach((vertex, index) => {
            if (index === 0) ctx.moveTo(vertex.x - body.position.x, vertex.y - body.position.y);
            else ctx.lineTo(vertex.x - body.position.x, vertex.y - body.position.y);
        });
        ctx.closePath();

        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 15; ctx.shadowOffsetY = 8; // 陰影配合放大

        if (isTimeFrozen) {
            ctx.fillStyle = (body === freezeTarget) ? "#f1c40f" : "#444444";
            ctx.strokeStyle = "#ffffff";
        } else {
            ctx.fillStyle = (body.label === "P1") ? "#c0392b" : "#2980b9";
            ctx.strokeStyle = "#111111"; 
        }
        
        ctx.lineWidth = 4;
        ctx.fill();

        // 內部自轉紋理同步放大
        if (pState && !pState.isShattered) {
            ctx.beginPath(); ctx.arc(0, 0, 42, 0, Math.PI); // 24 -> 42
            ctx.fillStyle = "rgba(0, 0, 0, 0.25)"; ctx.fill();
            ctx.beginPath(); ctx.arc(0, 0, 42, Math.PI, Math.PI * 2);
            ctx.fillStyle = "rgba(255, 255, 255, 0.25)"; ctx.fill();
        }
        
        ctx.shadowColor = "transparent";
        ctx.stroke();

        // 頂部立體中心軸放大
        if (pState && !pState.isShattered) {
            let domeGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 25);
            domeGradient.addColorStop(0, "rgba(255, 255, 255, 0.8)");
            domeGradient.addColorStop(1, "rgba(0, 0, 0, 0.3)");
            ctx.beginPath(); ctx.arc(0, 0, 25, 0, Math.PI * 2); // 15 -> 25
            ctx.fillStyle = domeGradient; ctx.fill();
            ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); // 4 -> 8
            ctx.fillStyle = "#ffffff"; ctx.fill();
        }

        ctx.rotate(-body.angle);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 32px sans-serif"; // 字體大幅升級 20px -> 32px
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        if (pState) ctx.fillText(`${pState.currentUpper}${pState.currentLower}`, 0, 0);

        ctx.restore();
    });

    // 繪製碎裂特效
    updateAndDrawParticles();

    if (isTimeFrozen && freezeTarget) {
        ctx.save();
        ctx.font = "bold 56px serif";
        ctx.fillStyle = `rgba(255, 255, 255, ${freezeAlpha})`;
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(241, 196, 15, 0.6)";
        ctx.shadowBlur = 15;
        ctx.fillText(freezeText, 400, 200);
        ctx.restore();
        freezeAlpha -= 0.012; 
    }

    ctx.restore(); // 結束震動影響範圍

    drawUI();
    requestAnimationFrame(drawGame);
}

function drawUI() {
    ctx.fillStyle = isTimeFrozen ? "#888" : "#aaaaaa";
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    
    let p1Txt = "";
    if (p1State.isShattered) p1Txt = "【P1 陣地】已碎裂崩解";
    else if (p1State.body) p1Txt = `【P1 陣地】正在對戰: ${p1State.currentUpper}${p1State.currentLower}`;
    else p1Txt = p1State.upper ? `已選上卦【${p1State.upper}】，再點選下卦` : "【P1 陣地】上半部雙擊起卦...";
    ctx.fillText(p1Txt, 400, 40);

    let p2Txt = "";
    if (p2State.isShattered) p2Txt = "【P2 陣地】已碎裂崩解";
    else if (p2State.body) p2Txt = `【P2 陣地】正在對戰: ${p2State.currentUpper}${p2State.currentLower}`;
    else p2Txt = p2State.upper ? `已選上卦【${p2State.upper}】，再點選下卦` : "【P2 陣地】下半部雙擊起卦...";
    ctx.fillText(p2Txt, 400, canvas.height - 40);

    if (gameState === "p1_win" || gameState === "p2_win") {
        ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.font = "bold 72px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        
        if (gameState === "p1_win") {
            ctx.fillStyle = "#e74c3c";
            ctx.fillText("上陣 (P1) 勝利！", 400, 360);
        } else {
            ctx.fillStyle = "#3498db";
            ctx.fillText("下陣 (P2) 勝利！", 400, 360);
        }
        
        ctx.font = "24px sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.fillText("點擊螢幕任何位置重新起卦", 400, 450);
    }
}