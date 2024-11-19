// ==UserScript==
// @name     Instant KBA
// @version  0.1
// @grant    none
// @match    *://itsm.services.sap/*
// @include  *://itsm.services.sap/*
// @exclude  *://itsm.services.sap/attach_knowledge*
// @exclude  *://itsm.services.sap/*record/incident*
// ==/UserScript==

/*
 * For example cases you can check Guided Engineering backend:
 * https://supportportaltest-ge-approuter.internal.cfapps.sap.hana.ondemand.com/ahui/#/SupportCase
 */
const forceEnv = null;

// Exposed functions
API = {
  openQuickView,
  sendAnalytics,
  getTemplates,
  Pulse: {
    get: getPulse,
    update: updatePulse,
  },
  GuidedEngineering: {
    getHistoryData,
    getAvailableAutomationsForComponent,
    executeAutomation,
    addFeedbackForAutomation,
  },
};

/**
 * Get pulse record
 */
async function getPulse(case_id) {
  try {
    const res = await caRequest(`/case/pulse/${case_id}`);
    if (res?.length) {
      return res[0];
    }
    if (Array.isArray(res) && res.length === 0) {
      return "New";
    }
    return null;
  } catch (e) {
    console.error(e);
    return null;
  }
}

/**
 * Update pulse record
 */
async function updatePulse(case_id, data) {
  const res = await caRequest(`/case/pulse/${case_id}`, "POST", data);
  return res;
}

function higherVersion(v1, v2) {
  var v1parts = v1.split(".").map(Number);
  var v2parts = v2.split(".").map(Number);
  for (var i = 0; i < v1parts.length; ++i) {
    if (v2parts.length == i) {
      return v1;
    }
    if (v1parts[i] == v2parts[i]) {
      continue;
    } else if (v1parts[i] > v2parts[i]) {
      return v1;
    } else {
      return v2;
    }
  }
  if (v1parts.length != v2parts.length) {
    return v2;
  }
  return v1;
}

async function getTemplates() {
  try {
    const minVersion = "1.6.44";
    const iseVersion = await window.ise.system_info.getISEVersion();
    if (higherVersion(iseVersion, minVersion) === minVersion) {
      return [];
    }
    const res = await ise.events.send("engine-case-get-templates");
    if (!res?.length) {
      return null;
    }
    const parsed = JSON.parse(res);
    const parsedKeys = Object.keys(parsed);
    const templates = [];
    for (let i = 0; i < parsedKeys.length; i++) {
      if (parsedKeys[i].startsWith("template_metadata_")) {
        const template = JSON.parse(parsed[parsedKeys[i]]);
        const templateText = parsed["template_text_" + template.id];
        templates.push({ title: template.title, description: "Maintained by the ServiceNow Tools script.", content: templateText });
      }
    }
    return templates;
  } catch (e) {
    console.error(e);
    return null;
  }
}

async function openQuickView(url) {
  ise.events.send("browserwindow-isewindow-popupwindow-open", url);
}

/**
 * Get Intelligent Automation history for a given correlation id
 */
async function getHistoryData(correlation_id) {
  const res = await iaRequest(`/automations/history/${correlation_id}`);
  if (res?.length) {
    res.sort((a, b) => {
      try {
        if (a?.status === "RUNNING") return -1;
        if (b?.status === "RUNNING") return -1;
        if (moment(a?.completed_ts) > moment(b?.completed_ts)) {
          return -1;
        }
        return 1;
      } catch (e) {
        return 1;
      }
    });
  }
  return res;
}

/**
 * Add feedback for automation
 */
async function addFeedbackForAutomation(automation_id, workflow_id, val) {
  let payload = {
    automation_id,
    workflow_id,
  };
  if (val === null) {
    payload.thumb_up = false;
    payload.thumb_down = false;
  } else {
    if (val) {
      payload.thumb_up = true;
      payload.thumb_down = false;
    } else {
      payload.thumb_up = false;
      payload.thumb_down = true;
    }
  }
  const res = await iaRequest(`/automation/feedback`, "POST", payload);
  return res;
}

/**
 * Get list of Intelligent Automation automations
 */
async function getAvailableAutomationsForComponent(component, product_name) {
  let res = null;
  if (product_name?.length) {
    res = await iaRequest(`/automations/${component}?product=${encodeURIComponent(product_name)}`);
  } else {
    res = await iaRequest(`/automations/${component}`);
  }
  return res;
}

/**
 * Execute an automation for a case
 */
async function executeAutomation(automation_id, correlation_id, component, runtimeOptions) {
  let options = [];
  if (runtimeOptions) {
    runtimeOptions = Object.values(runtimeOptions);
  }
  if (runtimeOptions?.length) {
    for (let i = 0; i < runtimeOptions.length; i++) {
      let values = [];
      // Selectbox
      if (runtimeOptions[i]?.control === "selectbox") {
        if (runtimeOptions[i].values?.value) {
          // Single
          values = [runtimeOptions[i].values.value];
        } else {
          // Multi
          values = runtimeOptions[i].values.map((item) => item.value);
        }
      } else {
        // Freetext
        values = [runtimeOptions[i]?.value || ""];
      }
      options.push({
        name: runtimeOptions[i].option.name,
        values,
      });
    }
  }
  const res = await iaRequest(`/automation/execute`, "POST", {
    id: automation_id,
    incident_no: correlation_id,
    component,
    options,
  });
  return res;
}

/**
 * Sends analytics to HANA
 */
async function sendAnalytics(action, metadata = undefined) {
  ise.events.send("engine-logger-track-hana", {
    view: "case_assistant",
    action,
    metadata,
  });
}

/**
 * Make request to backend-case-assistant
 */
let caToken = null;
async function caRequest(path, method = "GET", body = undefined) {
  if (!caToken) {
    const tokenRes = await ise.events.send("engine-sso-request", {
      env: forceEnv || undefined,
      service: "supportportal_token",
    });
    caToken = tokenRes?.token;
  }
  const res = await ise.events.send("engine-request", {
    service: "backend-case-assistant",
    method,
    env: forceEnv || undefined,
    body,
    path,
    headers: {
      Authorization: `Bearer ${caToken}`,
    },
  });
  return res;
}

/**
 * Make request to backend-guided-engineering
 */

async function iaRequest(path, method = "GET", body = undefined) {
  document.querySelector(".spinner").style.display = "block";

  const tokenRes = await ise.events.send("engine-sso-request", {
    env: forceEnv || undefined,
    service: "guided-engineering-token",
  });
  let iaToken = tokenRes?.token;

  const res = await ise.events.send("engine-request", {
    service: "backend-guided-engineering",
    method,
    env: forceEnv || undefined,
    body,
    path,
    headers: {
      Authorization: `Bearer ${iaToken}`,
    },
  });
  document.querySelector(".spinner").style.display = "none";
  return res;
}

/*****************************************************************************************************/

var defaultTopPosition = "157px";
var defaultLeftPosition = "812px";
try{
  //get position
  if(localStorage.getItem("instant_Kba_default_position").length > 0){
    defaultLeftPosition = (localStorage.getItem("instant_Kba_default_position").split(",")[0]);
    defaultTopPosition = (localStorage.getItem("instant_Kba_default_position").split(",")[1]);
  }
}catch(err){
  
}

var instantKbaDiv = document.createElement("div");
instantKbaDiv.setAttribute("style","z-index:99; display:inline; position:absolute; left:"+defaultLeftPosition+"; top:"+defaultTopPosition+";")
instantKbaDiv.setAttribute("id","instantKbaDiv");
var kbaTextBox = document.createElement("input");
kbaTextBox.setAttribute("id","kbaText");
kbaTextBox.setAttribute("style","z-index:99; display:inline-block vertical-align:middle; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif));");
kbaTextBox.setAttribute("placeholder","Enter KBA and hit Enter");
var bridgeButton = document.createElement("button");
bridgeButton.setAttribute("id","bridgeButton");
bridgeButton.setAttribute("style","cursor:pointer; z-index:99; display:inline-block; vertical-align:middle; padding:1.5px 5px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); border-width:var(--now-button--secondary--border-width,var(--now-button--border-width,var(--now-actionable--border-width,1px))); color:RGB(var(--now-button--secondary--color,var(--now-color--neutral-18,22,27,28))); font-family: var(--now-button--font-family,var(--now-actionable--font-family,var(--now-font-family,\"Source Sans Pro\",Arial,sans-serif))); font-style:var(--now-button--font-style,var(--now-actionable--font-style,normal)); font-weight:var(--now-button--font-weight,var(--now-actionable--font-weight,normal)); font-size:1rem; line-weight:1.25;");
bridgeButton.innerHTML = "Bridge KBAs";
instantKbaDiv.innerHTML = "<span style=\"cursor:move;\">&nbsp⁞⁞⁞&nbsp</span>";
instantKbaDiv.appendChild(kbaTextBox);
instantKbaDiv.appendChild(bridgeButton);
var caseData;


/*navigation.addEventListener("navigate", e => {
  if(e.destination.url.toString().indexOf("/record/incident")>=0){
    kbaTextBox.setAttribute("style","z-index:99; display:inline-block vertical-align:middle; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif));");
    document.body.appendChild(instantKbaDiv);
  }else if(caseData.types[0] == "nocase"){
    document.getElementById("kbaText").value = "";
    document.body.removeChild(document.getElementById("instantKbaDiv"));
  }else if(e.destination.url.toString().indexOf("kb_template_kcs_article")>=0 || e.destination.url.toString().indexOf("sn_customerservice_action_plans")>=0){
    kbaTextBox.setAttribute("style","z-index:99; display:inline-block vertical-align:middle; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif));");
    document.getElementById("kbaText").value = "";
    document.body.removeChild(document.getElementById("instantKbaDiv"));
  }else{
    document.body.appendChild(instantKbaDiv);
  }
});*/

//Setting content when case is opened
ise.case.onUpdate2(
    async (receivedCaseData) => {
      if(receivedCaseData.types[0] == "nocase"){
        document.getElementById("kbaText").value = "";
        document.body.removeChild(document.getElementById("instantKbaDiv"));
        caseData.types[0] = "nocase";
        kbaTextBox.setAttribute("style","z-index:99; display:inline-block vertical-align:middle; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif));");
      }else if (receivedCaseData.types[0] == "headers"){
        caseData = receivedCaseData;
        if(window.location.href.toString().indexOf("/record/incident") >= 0){
          document.body.appendChild(instantKbaDiv);
        }else{
          document.body.appendChild(instantKbaDiv);
        }
      }      
  },
  ["headers"]);


//set persistent draggable box
var container = instantKbaDiv;

function handleMouseMove(event){
  event.preventDefault();
  onMouseDrag(event.x,event.y);
}

function onMouseDrag(movementX, movementY){
  var containerStyle = window.getComputedStyle(container);
  container.style.position = "absolute";
  container.style.left = (movementX-relativeMouseX)+"px";
  container.style.top = (movementY-relativeMouseY)+"px";
  defaultLeftPosition = (movementX-relativeMouseX)+"px";
  defaultTopPosition = (movementY-relativeMouseY)+"px";
  localStorage.setItem("instant_Kba_default_position",(defaultLeftPosition+","+defaultTopPosition));
}

container.addEventListener("mousedown", (e)=>{
  bounds = container.getBoundingClientRect();
  relativeMouseX = e.clientX - bounds.left;
  relativeMouseY = e.clientY - bounds.top;
  document.addEventListener("mousemove", handleMouseMove);
});

document.addEventListener("mouseup",()=>{
  document.removeEventListener("mousemove", handleMouseMove);
});