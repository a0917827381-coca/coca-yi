// --- 1. 初始化 Matter.js 模組 ---
const { Engine, World, Bodies, Body, Composite } = Matter;
const engine = Engine.create({ gravity: { x: 0, y: 0 } }); // 俯視角，重力為 0

// --- 2. 畫布與變數設定 ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = 800;
canvas.height = 800;

const ARENA_CENTER = { x: 400, y: 400 };
const ARENA_RADIUS = 380; 

let baguaData = null;
const baguaKeys = ["乾", "坤", "震", "巽", "坎", "離", "艮", "兌"];

// 玩家狀態包 (新增 isFallen 屬性判斷是否倒下)
let p1State = { upper: null, lower: null, currentUpper: "", currentLower: "", body: null, isFallen: false };
let p2State = { upper: null, lower: null, currentUpper: "", currentLower: "", body: null, isFallen: false };

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
    // 建立無形的外牆
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

// --- 4. 點擊監聽控制：上下陣地判定 ---
canvas.addEventListener('pointerdown', (e) => {
    if (!baguaData) return;
    const rect = canvas.getBoundingClientRect();
    
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    // Y 軸小於 400 歸 P1 (上方)，大於 400 歸 P2 (下方)
    if (mouseY < 400) {
        handlePlayerInput(p1State, 400, 150, "P1"); 
    } else {
        handlePlayerInput(p2State, 400, 650, "P2"); 
    }
});

function handlePlayerInput(player, spawnX, spawnY, label) {
    if (player.body && !player.isFallen) return; // 活著的狀態不可重複生成

    const randomGua = baguaKeys[Math.floor(Math.random() * baguaKeys.length)];

    if (!player.upper) {
        player.upper = randomGua;
    } else if (!player.lower) {
        player.lower = randomGua;
        spawnTop(player, spawnX, spawnY, label);
    }
}

function spawnTop(player, x, y, label) {
    // 如果場上已經有倒下的屍體，重新生成前先清掉舊的
    if (player.body && player.isFallen) {
        World.remove(engine.world, player.body);
    }

    const up = baguaData[player.upper].upper;
    const lo = baguaData[player.lower].lower;
    const radius = 32;

    let topBody;
    if (up.sides === 0) {
        topBody = Bodies.circle(x, y, radius, { label: label });
    } else {
        topBody = Bodies.polygon(x, y, up.sides, radius, { label: label });
    }

    Body.setMass(topBody, lo.mass);
    topBody.restitution = lo.restitution;
    topBody.friction = lo.friction;
    topBody.frictionAir = up.frictionAir;

    Body.setAngularVelocity(topBody, up.angularVelocity);
    
    // 計算朝向競技場中心的發射角度
    const angleToCenter = Math.atan2(ARENA_CENTER.y - y, ARENA_CENTER.x - x);
    Body.setVelocity(topBody, {
        x: Math.cos(angleToCenter) * 5,
        y: Math.sin(angleToCenter) * 5
    });

    // 更新狀態包
    player.body = topBody;
    player.currentUpper = player.upper;
    player.currentLower = player.lower;
    player.isFallen = false; // 確保新生出的陀螺是站立的

    World.add(engine.world, topBody);
}

// --- 5. 碰撞事件與時空凝結 ---
function setupCollisionListener() {
    Matter.Events.on(engine, 'collisionStart', (event) => {
        if (isTimeFrozen) return;

        event.pairs.forEach(pair => {
            const labelA = pair.bodyA.label;
            const labelB = pair.bodyB.label;

            // 確保是兩隻陀螺互撞 (排除撞到牆壁)
            if ((labelA === "P1" || labelA === "P2") && (labelB === "P1" || labelB === "P2")) {
                const speed = pair.collision.speed || 4;
                const impulse = pair.collision.depth * speed;

                if (impulse > 1.2) { 
                    const targetBody = Math.random() > 0.5 ? pair.bodyA : pair.bodyB;
                    // 倒下的殘骸不會觸發變卦特效
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

    engine.timing.timeScale = 0.05;

    setTimeout(() => {
        engine.timing.timeScale = 1.0; 
        isTimeFrozen = false;
        
        // 恢復正常速度時賦予推力向量
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
            Body.setVelocity(body, Matter.Vector.mult(normDir, 15));
            Body.setAngularVelocity(body, 0.45);
            break;
        case "離": 
            const randomAngle = Math.random() * Math.PI * 2;
            Body.setVelocity(body, { x: Math.cos(randomAngle) * 11, y: Math.sin(randomAngle) * 11 });
            Body.setVelocity(opponent, Matter.Vector.mult(normDir, 9)); 
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
            Body.setVelocity(body, Matter.Vector.mult(normDir, -6));
            break;
    }
}

// --- 6. 生存模式判定：新增「倒下 (isFallen)」狀態 ---
function checkSurvival(player) {
    if (!player.body) return;

    const pos = player.body.position;
    const distance = Math.hypot(pos.x - ARENA_CENTER.x, pos.y - ARENA_CENTER.y);

    // 條件一：出界 (Ring Out) 絕對死亡，直接移除
    if (distance > ARENA_RADIUS) {
        World.remove(engine.world, player.body);
        player.body = null;
        player.upper = null;
        player.lower = null;
        player.isFallen = false;
        return;
    }

    // 條件二：當雙方都在場上時，才開始判定是否倒下 (防呆機制)
    if (p1State.body && p2State.body && !player.isFallen) {
        // 放寬停止判定：轉速極低且移動速度極慢
        if (Math.abs(player.body.angularVelocity) < 0.005 && player.body.speed < 0.2) {
            player.isFallen = true; // 標記為倒下
            
            // 物理突變：倒下後摩擦力暴增，變成極重的屍體障礙物
            Matter.Body.setMass(player.body, player.body.mass * 10);
            player.body.friction = 0.8;
            Matter.Body.setAngularVelocity(player.body, 0); // 強制停止自轉
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

    // A. 背景與太極渲染
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

    // B. 陀螺實體繪製 (包含 2.5D 透視處理)
    const bodies = Composite.allBodies(engine.world);
    bodies.forEach(body => {
        if (body.isStatic) return; 

        ctx.save();
        ctx.translate(body.position.x, body.position.y);
        ctx.rotate(body.angle);

        const pState = (body.label === "P1") ? p1State : p2State;

        // 【視覺欺騙核心】如果是倒下狀態，垂直壓扁一半，產生倒下的透視感
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
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 5;

        // 判定顏色
        if (isTimeFrozen) {
            ctx.fillStyle = (body === freezeTarget) ? "#f1c40f" : "#444444";
            ctx.strokeStyle = "#ffffff";
        } else {
            ctx.fillStyle = (body.label === "P1") ? "#c0392b" : "#2980b9";
            ctx.strokeStyle = (pState && pState.isFallen) ? "#555555" : "#111111"; // 倒下時邊緣變暗
        }
        
        ctx.lineWidth = 2;
        ctx.fill();
        
        ctx.shadowColor = "transparent";
        ctx.stroke();

        // 繪製頂部立體中心軸
        if (pState && !pState.isFallen) {
            // 站立時的立體反光
            let domeGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 15);
            domeGradient.addColorStop(0, "rgba(255, 255, 255, 0.8)");
            domeGradient.addColorStop(1, "rgba(0, 0, 0, 0.3)");
            
            ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2);
            ctx.fillStyle = domeGradient; ctx.fill();
            
            ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2);
            ctx.fillStyle = "#ffffff"; ctx.fill();
        } else if (pState && pState.isFallen) {
            // 倒下時，畫出側躺的中心軸
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(25, 0); 
            ctx.lineWidth = 4; ctx.strokeStyle = "#888888"; ctx.stroke();
        }

        ctx.rotate(-body.angle);
        ctx.fillStyle = (pState && pState.isFallen) ? "#888888" : "#ffffff";
        ctx.font = "bold 16px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        if (pState) ctx.fillText(`${pState.currentUpper}${pState.currentLower}`, 0, 0);

        ctx.restore();
    });

    // C. 渲染時空凝結文字
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

// 介面文字更新
function drawUI() {
    ctx.fillStyle = isTimeFrozen ? "#888" : "#aaaaaa";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "center";
    
    // P1 UI 文字
    let p1Txt = "";
    if (p1State.isFallen) {
        p1Txt = "【P1 陣地】已倒下 (再雙擊可重起新卦)";
    } else if (p1State.body) {
        p1Txt = `【P1 陣地】正在對戰: ${p1State.currentUpper}${p1State.currentLower}`;
    } else {
        p1Txt = p1State.upper ? `已選上卦【${p1State.upper}】，再點選下卦` : "【P1 陣地】上半部雙擊起卦...";
    }
    ctx.fillText(p1Txt, 400, 40);

    // P2 UI 文字
    let p2Txt = "";
    if (p2State.isFallen) {
        p2Txt = "【P2 陣地】已倒下 (再雙擊可重起新卦)";
    } else if (p2State.body) {
        p2Txt = `【P2 陣地】正在對戰: ${p2State.currentUpper}${p2State.currentLower}`;
    } else {
        p2Txt = p2State.upper ? `已選上卦【${p2State.upper}】，再點選下卦` : "【P2 陣地】下半部雙擊起卦...";
    }
    ctx.fillText(p2Txt, 400, canvas.height - 40);
}