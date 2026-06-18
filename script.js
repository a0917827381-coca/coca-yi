// --- 1. 初始化 Matter.js 模組 ---
const { Engine, World, Bodies, Body, Composite } = Matter;
const engine = Engine.create({ gravity: { x: 0, y: 0 } }); // 俯視角，重力為 0
const NORMAL_TIME_SCALE = 0.8; // 全局降速，增加戰鬥的沉重感與可視度
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

// 玩家與遊戲狀態包
let p1State = { upper: null, lower: null, currentUpper: "", currentLower: "", body: null, isFallen: false };
let p2State = { upper: null, lower: null, currentUpper: "", currentLower: "", body: null, isFallen: false };
let gameState = "wait"; // 狀態機：wait, battle, p1_win, p2_win

// 時空凝結控制狀態
let isTimeFrozen = false;
let freezeTarget = null;
let freezeText = "";
let freezeAlpha = 1.0;

// --- 3. 非同步載入八卦 JSON 資料檔 ---
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

    // 如果已經分出勝負，點擊一次用來清理畫面並重置起卦狀態
    if (gameState === "p1_win" || gameState === "p2_win") {
        gameState = "wait";
        p1State.upper = null; p1State.lower = null;
        p2State.upper = null; p2State.lower = null;
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
    if (player.body && !player.isFallen) return; 

    const randomGua = baguaKeys[Math.floor(Math.random() * baguaKeys.length)];

    if (!player.upper) {
        player.upper = randomGua;
    } else if (!player.lower) {
        player.lower = randomGua;
        spawnTop(player, spawnX, spawnY, label);
    }
}

function spawnTop(player, x, y, label) {
    if (player.body && player.isFallen) {
        World.remove(engine.world, player.body);
    }

    const up = baguaData[player.upper].upper;
    const lo = baguaData[player.lower].lower;
    const radius = 48; // 【大幅增加陀螺體積】從 32 提升至 48

    let topBody;
    if (up.sides === 0) {
        topBody = Bodies.circle(x, y, radius, { label: label });
    } else {
        topBody = Bodies.polygon(x, y, up.sides, radius, { label: label });
    }

    Body.setMass(topBody, lo.mass * 1.5); // 整體質量放大，避免像塑膠玩具
    topBody.restitution = lo.restitution;
    topBody.friction = lo.friction;
    topBody.frictionAir = up.frictionAir;

    Body.setAngularVelocity(topBody, up.angularVelocity);
    
    const angleToCenter = Math.atan2(ARENA_CENTER.y - y, ARENA_CENTER.x - x);
    Body.setVelocity(topBody, {
        x: Math.cos(angleToCenter) * 3.5, // 降低初始暴衝速度
        y: Math.sin(angleToCenter) * 3.5
    });

    player.body = topBody;
    player.currentUpper = player.upper;
    player.currentLower = player.lower;
    player.isFallen = false;

    World.add(engine.world, topBody);

    // 雙方都存活且在場上時，進入戰鬥狀態
    if (p1State.body && !p1State.isFallen && p2State.body && !p2State.isFallen) {
        gameState = "battle";
    }
}

// --- 5. 碰撞事件與時空凝結 ---
function setupCollisionListener() {
    Matter.Events.on(engine, 'collisionStart', (event) => {
        if (isTimeFrozen || gameState !== "battle") return;

        event.pairs.forEach(pair => {
            const labelA = pair.bodyA.label;
            const labelB = pair.bodyB.label;

            if ((labelA === "P1" || labelA === "P2") && (labelB === "P1" || labelB === "P2")) {
                const speed = pair.collision.speed || 4;
                const impulse = pair.collision.depth * speed;

                if (impulse > 1.8) { // 提高變卦閾值，減少頻繁的暫停
                    const targetBody = Math.random() > 0.5 ? pair.bodyA : pair.bodyB;
                    const targetState = (targetBody.label === "P1") ? p1State : p2State;
                    if (!targetState.isFallen) {
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

    engine.timing.timeScale = 0.02; // 極致的子彈時間

    setTimeout(() => {
        engine.timing.timeScale = NORMAL_TIME_SCALE; // 恢復我們設定的較慢全局速度
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
            Body.setVelocity(body, Matter.Vector.mult(normDir, 12));
            Body.setAngularVelocity(body, 0.45);
            break;
        case "離": 
            const randomAngle = Math.random() * Math.PI * 2;
            Body.setVelocity(body, { x: Math.cos(randomAngle) * 9, y: Math.sin(randomAngle) * 9 });
            Body.setVelocity(opponent, Matter.Vector.mult(normDir, 7)); 
            break;
        case "艮": 
            Body.setVelocity(body, { x: 0, y: 0 });
            Body.setMass(body, body.mass * 4);
            break;
        case "巽": 
            Body.setAngularVelocity(body, 0.5);
            body.frictionAir = 0.0001;
            break;
        default: 
            Body.setVelocity(body, Matter.Vector.mult(normDir, -5));
            break;
    }
}

// --- 6. 生存模式判定：勝負結算觸發器 ---
function checkSurvival(player) {
    if (!player.body) return;

    const pos = player.body.position;
    const distance = Math.hypot(pos.x - ARENA_CENTER.x, pos.y - ARENA_CENTER.y);
    let isOut = distance > ARENA_RADIUS;
    let isStopped = false;

    if (gameState === "battle" && p1State.body && p2State.body && !player.isFallen) {
        if (Math.abs(player.body.angularVelocity) < 0.005 && player.body.speed < 0.2) {
            isStopped = true;
        }
    }

    // 當有玩家出局或停止
    if (isOut || isStopped) {
        // 判定對手獲勝
        if (gameState === "battle") {
            gameState = (player === p1State) ? "p2_win" : "p1_win";
        }

        if (isOut) {
            World.remove(engine.world, player.body);
            player.body = null;
            player.isFallen = false;
        } else {
            player.isFallen = true;
            Matter.Body.setMass(player.body, player.body.mass * 10);
            player.body.friction = 0.8;
            Matter.Body.setAngularVelocity(player.body, 0);
        }
    }
}

// --- 7. 手動 Canvas 渲染與 UI 更新循環 ---
function drawGame() {
    Engine.update(engine, 1000 / 60);

    if (!isTimeFrozen) {
        checkSurvival(p1State);
        checkSurvival(p2State);
    }

    if (isTimeFrozen) {
        ctx.fillStyle = "#0a0a0a"; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let arenaGradient = ctx.createRadialGradient(
            ARENA_CENTER.x, ARENA_CENTER.y, ARENA_RADIUS * 0.8,
            ARENA_CENTER.x, ARENA_CENTER.y, ARENA_RADIUS
        );
        arenaGradient.addColorStop(0, "rgba(255,255,255,0)");
        arenaGradient.addColorStop(1, "rgba(0,0,0,0.6)"); 

        ctx.save();
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
        ctx.restore();
    }

    const bodies = Composite.allBodies(engine.world);
    bodies.forEach(body => {
        if (body.isStatic) return; 

        ctx.save();
        ctx.translate(body.position.x, body.position.y);
        ctx.rotate(body.angle);

        const pState = (body.label === "P1") ? p1State : p2State;

        if (pState && pState.isFallen) {
            ctx.scale(1, 0.5); 
        }

        ctx.beginPath();
        body.vertices.forEach((vertex, index) => {
            if (index === 0) ctx.moveTo(vertex.x - body.position.x, vertex.y - body.position.y);
            else ctx.lineTo(vertex.x - body.position.x, vertex.y - body.position.y);
        });
        ctx.closePath();

        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 10; ctx.shadowOffsetY = 5;

        if (isTimeFrozen) {
            ctx.fillStyle = (body === freezeTarget) ? "#f1c40f" : "#444444";
            ctx.strokeStyle = "#ffffff";
        } else {
            ctx.fillStyle = (body.label === "P1") ? "#c0392b" : "#2980b9";
            ctx.strokeStyle = (pState && pState.isFallen) ? "#555555" : "#111111"; 
        }
        
        ctx.lineWidth = 3;
        ctx.fill();

        // 【視覺強化】畫出內部的太極色塊，讓旋轉超級明顯
        if (pState && !pState.isFallen) {
            ctx.beginPath();
            ctx.arc(0, 0, 24, 0, Math.PI);
            ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
            ctx.fill();
            ctx.beginPath();
            ctx.arc(0, 0, 24, Math.PI, Math.PI * 2);
            ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
            ctx.fill();
        }
        
        ctx.shadowColor = "transparent";
        ctx.stroke();

        // 頂部立體中心軸
        if (pState && !pState.isFallen) {
            let domeGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 15);
            domeGradient.addColorStop(0, "rgba(255, 255, 255, 0.8)");
            domeGradient.addColorStop(1, "rgba(0, 0, 0, 0.3)");
            ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2);
            ctx.fillStyle = domeGradient; ctx.fill();
            ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2);
            ctx.fillStyle = "#ffffff"; ctx.fill();
        } else if (pState && pState.isFallen) {
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(25, 0); 
            ctx.lineWidth = 4; ctx.strokeStyle = "#888888"; ctx.stroke();
        }

        ctx.rotate(-body.angle);
        ctx.fillStyle = (pState && pState.isFallen) ? "#888888" : "#ffffff";
        ctx.font = "bold 20px sans-serif"; // 字體配合陀螺放大
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        if (pState) ctx.fillText(`${pState.currentUpper}${pState.currentLower}`, 0, 0);

        ctx.restore();
    });

    if (isTimeFrozen && freezeTarget) {
        ctx.save();
        ctx.font = "bold 42px serif";
        ctx.fillStyle = `rgba(255, 255, 255, ${freezeAlpha})`;
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(241, 196, 15, 0.6)";
        ctx.shadowBlur = 12;
        ctx.fillText(freezeText, 400, 200);
        ctx.restore();
        freezeAlpha -= 0.012; 
    }

    drawUI();
    requestAnimationFrame(drawGame);
}

// 介面與勝負結算畫面更新
function drawUI() {
    ctx.fillStyle = isTimeFrozen ? "#888" : "#aaaaaa";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "center";
    
    let p1Txt = "";
    if (p1State.isFallen) p1Txt = "【P1 陣地】已倒下";
    else if (p1State.body) p1Txt = `【P1 陣地】正在對戰: ${p1State.currentUpper}${p1State.currentLower}`;
    else p1Txt = p1State.upper ? `已選上卦【${p1State.upper}】，再點選下卦` : "【P1 陣地】上半部雙擊起卦...";
    ctx.fillText(p1Txt, 400, 40);

    let p2Txt = "";
    if (p2State.isFallen) p2Txt = "【P2 陣地】已倒下";
    else if (p2State.body) p2Txt = `【P2 陣地】正在對戰: ${p2State.currentUpper}${p2State.currentLower}`;
    else p2Txt = p2State.upper ? `已選上卦【${p2State.upper}】，再點選下卦` : "【P2 陣地】下半部雙擊起卦...";
    ctx.fillText(p2Txt, 400, canvas.height - 40);

    // 【新增】巨大化的勝負結算畫面
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