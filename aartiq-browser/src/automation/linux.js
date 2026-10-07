const { execSync } = require('child_process');
const path = require('path');

let isInitialized = false;
let useXdotool = true;
let useXdotest = false;
let available = false;

async function initialize() {
  if (isInitialized) return available;
  
  try {
    execSync('which xdotool', { stdio: 'ignore' });
    useXdotool = true;
    available = true;
    console.log('[Automation/Linux] Using xdotool');
  } catch {
    try {
      execSync('which xte', { stdio: 'ignore' });
      useXdotool = false;
      useXdotest = true;
      available = true;
      console.log('[Automation/Linux] Using xte/xinput');
    } catch {
      console.log('[Automation/Linux] Using xdotest (X11)');
      useXdotool = false;
      useXdotest = false;
      available = false;
    }
  }
  
  isInitialized = true;
  return available;
}

function moveMouse(x, y) {
  if (useXdotool) {
    execSync(`xdotool mousemove ${x} ${y}`, { stdio: 'ignore' });
  } else if (useXdotest) {
    execSync(`xte "mousemove ${x} ${y}"`, { stdio: 'ignore' });
  } else {
    execSync(`xdotool mousemove ${x} ${y}`, { stdio: 'ignore' });
  }
}

function click(x, y, button = 'left', double = false) {
  moveMouse(x, y);
  
  const buttonMap = { 'left': 1, 'right': 3, 'middle': 2 };
  const btn = buttonMap[button] || 1;
  const clickType = double ? 'click' : 'click';
  
  if (useXdotool) {
    const clicks = double ? 2 : 1;
    for (let i = 0; i < clicks; i++) {
      execSync(`xdotool click ${btn}`, { stdio: 'ignore' });
    }
  } else if (useXdotest) {
    const xteButton = { 'left': '1', 'right': '3', 'middle': '2' }[button] || '1';
    const down = double ? 'mouseclick d' : `mouseclick d${xteButton}`;
    const up = double ? 'mouseclick u' : `mouseclick u${xteButton}`;
    execSync(`xte "${down}" "usleep 10000" "${up}"`, { stdio: 'ignore' });
  } else {
    execSync(`xdotool click ${btn}`, { stdio: 'ignore' });
  }
}

function typeText(text) {
  const sanitized = text
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
  
  if (useXdotool) {
    try {
      execSync(`xdotool type --delay 10 "${sanitized}"`, { stdio: 'ignore' });
    } catch {
      execSync(`xte "str ${sanitized}"`, { stdio: 'ignore' });
    }
  } else if (useXdotest) {
    execSync(`xte "str ${sanitized}"`, { stdio: 'ignore' });
  }
}

function keyTap(key, modifiers = []) {
  const keyMap = {
    'return': 'Return',
    'enter': 'Return',
    'tab': 'Tab',
    'escape': 'Escape',
    'esc': 'Escape',
    'delete': 'Delete',
    'backspace': 'BackSpace',
    'up': 'Up',
    'down': 'Down',
    'left': 'Left',
    'right': 'Right',
    'home': 'Home',
    'end': 'End',
    'pageup': 'Prior',
    'pagedown': 'Next',
    'space': 'space',
    'shift': 'Shift_L',
    'control': 'Control_L',
    'ctrl': 'Control_L',
    'alt': 'Alt_L',
    'meta': 'Super_L',
    'command': 'Super_L'
  };
  
  const keyName = keyMap[key.toLowerCase()] || key;
  
  if (useXdotool) {
    // xdotool has no --modifiers flag: modifiers go inside the keystroke
    // itself ("ctrl+alt+n"), using the aliases alt/ctrl/shift/super/meta.
    const modAliases = {
      'shift': 'shift',
      'control': 'ctrl',
      'ctrl': 'ctrl',
      'alt': 'alt',
      'meta': 'meta',
      'super': 'super',
      'command': 'super'
    };
    const mods = modifiers.map((m) => modAliases[m.toLowerCase()] || m);
    execSync(`xdotool key ${[...mods, keyName].join('+')}`, { stdio: 'ignore' });
  } else if (useXdotest) {
    const modsDown = modifiers.map(m => `keydown ${keyMap[m.toLowerCase()] || m}`).join(' ');
    const modsUp = modifiers.map(m => `keyup ${keyMap[m.toLowerCase()] || m}`).join(' ');
    execSync(`xte "${modsDown}" "key ${keyName}" "${modsUp}"`, { stdio: 'ignore' });
  }
}

function scroll(x, y, direction, amount = 3) {
  moveMouse(x, y);
  
  const dirMap = {
    'up': 4,
    'down': 5,
    'left': 6,
    'right': 7
  };
  
  const btn = dirMap[direction] || 5;
  
  if (useXdotool) {
    for (let i = 0; i < amount; i++) {
      execSync(`xdotool click ${btn}`, { stdio: 'ignore' });
    }
  } else if (useXdotest) {
    execSync(`xte "mouseclick ${btn}"`, { stdio: 'ignore' });
  }
}

function getMousePos() {
  try {
    const output = execSync('xdotool getmouselocation --shell', { encoding: 'utf8' });
    const lines = output.split('\n');
    let x = 0, y = 0;
    
    for (const line of lines) {
      if (line.startsWith('X=')) x = parseInt(line.substring(2));
      if (line.startsWith('Y=')) y = parseInt(line.substring(2));
    }
    
    return { x, y };
  } catch {
    return { x: 0, y: 0 };
  }
}

module.exports = {
  initialize,
  moveMouse,
  click,
  typeText,
  keyTap,
  scroll,
  getMousePos,
  get isAvailable() { return available; }
};
