// ==UserScript==
// @name     Express KBA
// @version  2.0
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

var initialInnerWidth = window.innerWidth;

function addToCase(kbaId){
  if(caseData != ""){
    ise.tab.add("https://itsm.services.sap/attach_knowledge.do?targetTable=sn_customerservice_case&targetId="+caseData.id+"&source=cwf", { show: false } ).then((tab)=>{
      tabID = tab;
    });
    
    setTimeout(() => {
      let result = ise.tab.executeJavaScript(tabID, '(() => { document.getElementById("multiField").value = '+kbaId+'; })()');
      result = ise.tab.executeJavaScript(tabID, '(() => { document.getElementById("attachButton").click(); })()');
      result = ise.tab.executeJavaScript(tabID, '(() => { document.getElementById("closebutton").click(); })()');
    }, 3500);

    setTimeout(() => {
      document.getElementById("kba-success").style.display = "block";
    }, 4900);

    setTimeout(() => {
      document.getElementById("kba-success").style.display = "none";
    }, 8300);

  }
 }

var defaultTopPosition = "6.5%";
var defaultRightPosition = "5%";
var fallBackTopPosition = "6.5%";
var fallBackRightPosition = "5%";
try{
  //get position
  if(localStorage.getItem("instant_Kba_default_position").length > 0){
    defaultRightPosition = (localStorage.getItem("instant_Kba_default_position").split(",")[0]);
    defaultTopPosition = (localStorage.getItem("instant_Kba_default_position").split(",")[1]);
  }
}catch(err){
  
}

  instantKbaDiv = document.createElement("div");
  instantKbaDiv.setAttribute("style","z-index:9999; display:inline-block; vertical-align:baseline; position:absolute; right:"+defaultRightPosition+"; top:"+defaultTopPosition+";");
  instantKbaDiv.setAttribute("id","instantKbaDiv");
  var kbaTextBox = document.createElement("input");
  kbaTextBox.setAttribute("id","kbaText");
  kbaTextBox.setAttribute("style","z-index:9999; heigth:30.5px; width:160px; display:inline-block vertical-align:baseline; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif)); color:grey;");
  kbaTextBox.setAttribute("placeholder","Enter KBA to add to case:");
  var bridgeButton = document.createElement("button");
  bridgeButton.setAttribute("id","bridgeButton");
  bridgeButton.setAttribute("style","cursor:pointer; z-index:9999; display:inline-block; vertical-align:baseline; padding:1px 5px 2px 5px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); border-width:var(--now-button--secondary--border-width,var(--now-button--border-width,var(--now-actionable--border-width,1px))); color:RGB(var(--now-button--secondary--color,var(--now-color--neutral-18,22,27,28))); font-family: var(--now-button--font-family,var(--now-actionable--font-family,var(--now-font-family,\"Source Sans Pro\",Arial,sans-serif))); font-style:var(--now-button--font-style,var(--now-actionable--font-style,normal)); font-weight:var(--now-button--font-weight,var(--now-actionable--font-weight,normal)); font-size:0.85rem; line-weight:1.25;");
  bridgeButton.innerHTML = "★ Bookmarks";
  var helpButton = document.createElement("button");
  helpButton.setAttribute("id","helpButton");
  helpButton.setAttribute("style","cursor:pointer; z-index:9999; display:inline-block; margin-left:3px; vertical-align:baseline; padding:1px 5px 0.5px 5px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); border-width:var(--now-button--secondary--border-width,var(--now-button--border-width,var(--now-actionable--border-width,1px))); color:RGB(var(--now-button--secondary--color,var(--now-color--neutral-18,22,27,28))); font-family: var(--now-button--font-family,var(--now-actionable--font-family,var(--now-font-family,\"Source Sans Pro\",Arial,sans-serif))); font-style:var(--now-button--font-style,var(--now-actionable--font-style,normal)); font-weight:var(--now-button--font-weight,var(--now-actionable--font-weight,normal)); font-size:0.85rem; line-weight:1.25;");
  helpButton.innerHTML = "?";
  instantKbaDiv.innerHTML = "<span style=\"cursor:move;\">&nbsp⁞⁞⁞&nbsp</span>";
  instantKbaDiv.appendChild(kbaTextBox);
  instantKbaDiv.innerHTML = instantKbaDiv.innerHTML+" ";
  instantKbaDiv.appendChild(bridgeButton);
  instantKbaDiv.appendChild(helpButton);


var caseData;
//Setting content when case is opened
top.ise.case.onUpdate2(
    async (receivedCaseData) => {
      if(receivedCaseData.types[0] == "nocase"){
        document.getElementById("kbaText").value = "";
        document.body.removeChild(instantKbaDiv);
        caseData.types[0] = "nocase";
        kbaTextBox.setAttribute("style","z-index:9999; display:inline-block vertical-align:baseline; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif));");
        caseData = "";
      }else if (receivedCaseData.types[0] == "headers"){
        caseData = receivedCaseData;
        document.body.appendChild(instantKbaDiv);
      }      
  },
  ["headers"]);

  document.addEventListener("keypress", function(event) {
    if(event.key === "Enter"){
      var textBoxValue = document.getElementById("kbaText").value.toString();
      var kbaID = textBoxValue.trim().split(" ")[0].split("-")[0];
      addToCase(kbaID);
      document.getElementById("kbaText").value = "";
    }
  });

  //Load KBA List from Local Storage
  function loadFavoritesList(deleteMode){
    var favoriteList;
    try{
      favoriteList = localStorage.getItem("instant_kba_favorites").split("█");
    }catch(err){
      localStorage.setItem("instant_kba_favorites","");
      return "<span id=\"favoriteList\" style=\"font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif));\"><h3 style=\"margin:10px 0px 10px 210px;\">No favorited KBAs</h3>";
    }
    if(favoriteList == ""){
      return "<span id=\"favoriteList\" style=\"font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif));\"><h3 style=\"margin:10px 0px 10px 210px;\">No favorited KBAs</h3>";
    }

    if(deleteMode){
      var favoriteHTMLList = "<span id=\"favoriteList\" style=\"font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif));\"><h3 style=\"margin:10px 0px 0px 10px;\">Click to add a Favorite KBA to this case:</h3><ul style=\"text-align:left; list-style-position:inside; list-style-type:none; padding-left:5px;\">";
      favoriteList.forEach((element,index)  => {
        var kbaData = element.split("||");
        favoriteHTMLList = favoriteHTMLList + "<li style=\"margin-bottom:3px;\"><span style=\"cursor:pointer; overflow: hidden;\" id=\"instantkba:"+kbaData[0]+"\"><span id=\"deletekba:"+kbaData[0]+"--"+index+"\" style=\"color:red;\">X</span> "+kbaData[1]+"</span></li>";
      });
      favoriteHTMLList = favoriteHTMLList + "</ul></span>";
      return favoriteHTMLList;
    }else{
      var favoriteHTMLList = "<span id=\"favoriteList\" style=\"font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif));\"><h3 style=\"margin:10px 0px 0px 10px;\">Click to add a Favorite KBA to this case:</h3><ul style=\"text-align:left; list-style-position:inside; list-style-type:none; padding-left:5px;\">";
      favoriteList.forEach(element => {
        var kbaData = element.split("||");
        favoriteHTMLList = favoriteHTMLList + "<li style=\"margin-bottom:3px;\" style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\" id=\"instantkba:"+kbaData[0]+"\">• "+kbaData[1]+"</span></li>";
      });
      favoriteHTMLList = favoriteHTMLList + "</ul></span>";
      return favoriteHTMLList;
    }
    
  }

  //Add new KBA to favorites list
  function addKbaToList(kbaId,kbaNickname){
    var favoriteList;
    try{
      favoriteList = localStorage.getItem("instant_kba_favorites").split("█");
    }catch(err){
      localStorage.setItem("instant_kba_favorites","");
      favoriteList = [];
    }
    
    if(favoriteList[0] == ""){
      favoriteList = [kbaId+"||"+kbaNickname.substring(0,60)];
    }else{
      favoriteList.push(kbaId+"||"+kbaNickname.substring(0,60));
    }
    localStorage.setItem("instant_kba_favorites",favoriteList.join("█"));

    //update list
    document.getElementById("favoriteList").innerHTML = loadFavoritesList(true);
    document.getElementById("newKbaInput").value = "";
    document.getElementById("newKbaDescription").value = "";

    var editButton = document.createElement("button");
    editButton.setAttribute("style","cursor:pointer;  position:absolute;right:2%;top:10px;; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); border-width:var(--now-button--secondary--border-width,var(--now-button--border-width,var(--now-actionable--border-width,1px))); color:RGB(var(--now-button--secondary--color,var(--now-color--neutral-18,22,27,28))); font-family: var(--now-button--font-family,var(--now-actionable--font-family,var(--now-font-family,\"Source Sans Pro\",Arial,sans-serif))); font-style:var(--now-button--font-style,var(--now-actionable--font-style,normal)); font-weight:var(--now-button--font-weight,var(--now-actionable--font-weight,normal)); font-size:0.85rem; line-weight:1.25;");
    editButton.setAttribute("id","editList");
    editButton.innerHTML = "Edit List";
    document.getElementById("favoriteList").appendChild(editButton);
  }

  //Delete KBA from List
  function deleteKbaFromList(kbaIndex){
    var favoriteList;
    try{
      favoriteList = localStorage.getItem("instant_kba_favorites").split("█");
    }catch(err){
      localStorage.setItem("instant_kba_favorites","");
      favoriteList = [];
    }

    favoriteList.splice(kbaIndex.split("--")[1],1);
    localStorage.setItem("instant_kba_favorites",favoriteList.join("█"));

    //update list
    document.getElementById("favoriteList").innerHTML = loadFavoritesList(true);
    var editButton = document.createElement("button");
    editButton.setAttribute("style","cursor:pointer;  position:absolute;right:2%;top:10px;; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); border-width:var(--now-button--secondary--border-width,var(--now-button--border-width,var(--now-actionable--border-width,1px))); color:RGB(var(--now-button--secondary--color,var(--now-color--neutral-18,22,27,28))); font-family: var(--now-button--font-family,var(--now-actionable--font-family,var(--now-font-family,\"Source Sans Pro\",Arial,sans-serif))); font-style:var(--now-button--font-style,var(--now-actionable--font-style,normal)); font-weight:var(--now-button--font-weight,var(--now-actionable--font-weight,normal)); font-size:0.85rem; line-weight:1.25;");
    editButton.setAttribute("id","editList");
    editButton.innerHTML = "Edit List";
    document.getElementById("favoriteList").appendChild(editButton);

  }


//set persistent draggable box
var container = instantKbaDiv;
var button = bridgeButton;

function handleMouseMove(event){
  event.preventDefault();
  onMouseDrag(event.x,event.y);
}

function onMouseDrag(movementX, movementY){
  var containerStyle = window.getComputedStyle(container);
  container.style.position = "absolute";
  container.style.right = (100-(((movementX-relativeMouseX) / window.innerWidth)*100))+"%";
  container.style.top = (((movementY-relativeMouseY) / window.innerHeight)*100)+"%";
  defaultRightPosition = (100-(((movementX-relativeMouseX) / window.innerWidth)*100))+"%";
  defaultTopPosition = (((movementY-relativeMouseY) / window.innerHeight)*100)+"%";
  localStorage.setItem("instant_Kba_default_position",(defaultRightPosition+","+defaultTopPosition));
}

container.addEventListener("mousedown", (e)=>{
  bounds = container.getBoundingClientRect();
  relativeMouseX = e.clientX - bounds.right;
  relativeMouseY = e.clientY - bounds.top;
  document.addEventListener("mousemove", handleMouseMove);
});

document.addEventListener("mouseup",()=>{
  document.removeEventListener("mousemove", handleMouseMove);
});

var isBridgePopupOpen = false;
var isHelpPopupOpen = false;
var isListInEditMode = false;
document.addEventListener("click", (e)=>{

  //calculate horizontal shift of the popups (compare the full width of the screen with the position of the start of the widget - full width * percentage position/100 )
  var availableHorizontalSpace = window.innerWidth - (window.innerWidth * (100-(defaultRightPosition.replace("%","")/100)));
  var leftPosition = 0;
  if(availableHorizontalSpace < 660){
    leftPosition = -347;
  }

  //open bridge popup
  if(e.target.id == "bridgeButton"){
    var bridgePopup = document.createElement("div");
    bridgePopup.setAttribute("id","bridgePopup");
    var editButton = document.createElement("button");
    editButton.setAttribute("style","cursor:pointer;  position:absolute;right:2%;top:10px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); border-width:var(--now-button--secondary--border-width,var(--now-button--border-width,var(--now-actionable--border-width,1px))); color:RGB(var(--now-button--secondary--color,var(--now-color--neutral-18,22,27,28))); font-family: var(--now-button--font-family,var(--now-actionable--font-family,var(--now-font-family,\"Source Sans Pro\",Arial,sans-serif))); font-style:var(--now-button--font-style,var(--now-actionable--font-style,normal)); font-weight:var(--now-button--font-weight,var(--now-actionable--font-weight,normal)); font-size:0.85rem; line-weight:1.25;");
    editButton.setAttribute("id","editList");
    editButton.innerHTML = "Edit List";
    //load list from local storage
    bridgePopup.innerHTML = loadFavoritesList(false);
    //bridgePopup.innerHTML = "<span style=\"font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif));\"><h3 style=\"margin:10px 0px 0px 10px;\">Click to add a Favoritesg KBA to this case:</h3><ul style=\"text-align:left; list-style-position:inside; list-style-type:none; padding-left:5px;\"><li  style=\"margin-bottom:3px;\" style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\" id=\"instantkba:2531750\">• 2531750 - Project Specific Consulting Questions - Consulting provided to Customer</span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\" id=\"instantkba:2576522\">• 2576522 - Project Specific Consulting Questions</span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\" id=\"instantkba:2537493\">• 2537493 - Knowledge Gap / How To Question</span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\" id=\"instantkba:2531712\">• 2531712 - Incident Solved by SAP Help Center / SAP Community Documentation</span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\"  id=\"instantkba:2973358\">• 2973358 - SAP Community: Preferred Support Channel for How-To Questions</span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\"  id=\"instantkba:2537448\">• 2537448 - Handling Error</span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\"  id=\"instantkba:2543549\">• 2543549 - Error caused by Customer Modification (Wrong Modification / Customization)</span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\"  id=\"instantkba:2531826\">• 2531826 - Error caused by Customer Modification/Development (Wrong Modification caused by Add-On)</span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\"  id=\"instantkba:2543587\">• 2543587 - Issue caused by Third Party Solution</span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\"  id=\"instantkba:2531827\">• 2531827 - Functionality Currently not Available</span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\"  id=\"instantkba:2531921\">• 2531921 - Implementation or fix not Feasible in the Current Release - Functionality Planned for a Future Release </span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\"  id=\"instantkba:2531650\">• 2531650 - New Customer Request for Additional Feature or Function in SAP standard software</span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\"  id=\"instantkba:2531747\">• 2531747 - Feature/Functionality Considered for Release Planning </span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\"  id=\"instantkba:2528300\">• 2528300 - Product Too Complex to be Used Easily</span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\"  id=\"instantkba:2541693\">• 2541693 - Solution Provided by Hotfix Deployment</span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\"  id=\"instantkba:2541754\">• 2541754 - Solution Provided by Backend Correction</span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\"  id=\"instantkba:2532334\">• 2532334 - Supporting Knowledge Based Article : Known Limitation </span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\"  id=\"instantkba:2532326\">• 2532326 - Supporting Knowledge Based Article : New Limitation </span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\"  id=\"instantkba:2531828\">• 2531828 - Error Cannot be Reproduced: No Solution </span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\"  id=\"instantkba:2527097\">• 2527097 - Issue Solved by Hosting </span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\"  id=\"instantkba:3488027\">• 3488027 - Health Check Process</span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\"  id=\"instantkba:2531864\">• 2531864 - Duplicate Case Handling</span></li><li  style=\"margin-bottom:3px;\"><span style=\"cursor:pointer;\"  id=\"instantkba:2572475\">• 2572475 - Incident Created as a Test incident</span></li></ul></span>"
    bridgePopup.setAttribute("style","display:block; position:absolute; left:"+leftPosition+"px; width:660px; top:25px; background-color:RGB(var(--now-button--secondary--background-color,var(--now-color--neutral-3,209,214,214)),1);border-style:solid; border-width:1px; border-radius:8px; border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148)));");
    bridgePopup.appendChild(editButton);
    //close Help popup
    if(isBridgePopupOpen){
      instantKbaDiv.removeChild(document.getElementById("bridgePopup"));
      isBridgePopupOpen = false;
      isListInEditMode = false;
    }else{
      instantKbaDiv.appendChild(bridgePopup);
      isBridgePopupOpen = true;
    }
  //Add KBA from the list
  }else if(e.target.id.startsWith("instantkba:")){
    addToCase(e.target.id.replace("instantkba:",""));
    instantKbaDiv.removeChild(document.getElementById("bridgePopup"));
    isBridgePopupOpen = false;

  //Open Help Popup
  }else if(e.target.id == "helpButton"){
    var helpPopup = document.createElement("div");
    helpPopup.setAttribute("id","helpPopup");
    helpPopup.innerHTML = "The Express KBA script is used to quickly attach KBAs to SNOW cases. <br>Use the textbox on the left to type the KBA ID (or the entire KBA headline, for example \"123 - ABCDEF\") and hit the enter key on your keyboard to attach it to the currently open case.<br>You can also use the Bookmarks button to create a list of your commonly used KBAs, so you can attach them to the active case with a single click.<br>This widget can be dragged and positioned anywhere on the screen.<br><br>Currently active case: "+caseData.headers.data.number;
    helpPopup.setAttribute("style","padding: 4px; display:block; position:absolute; left:"+(leftPosition+15)+"px; width:660px; top:25px; background-color:RGB(var(--now-button--secondary--background-color,var(--now-color--neutral-3,209,214,214)),1);border-style:solid; border-width:1px; border-radius:8px; border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148)));");

    //Close bridge popup
    try{
      instantKbaDiv.removeChild(document.getElementById("bridgePopup"));
      isBridgePopupOpen = false;      
    }catch(err){}

    if(isHelpPopupOpen){
      instantKbaDiv.removeChild(document.getElementById("helpPopup"));
      isHelpPopupOpen = false;
    }else{
      instantKbaDiv.appendChild(helpPopup);
      isHelpPopupOpen = true;
    }
  //Edit KBA list when it is open
  }else if(e.target.id == "editList"){
    if(isListInEditMode){
      //close edit mode
      try{
        document.getElementById("bridgePopup").removeChild(document.getElementById("newKbaInputDiv"));
        document.getElementById("bridgePopup").innerHTML = loadFavoritesList(false);
        var editButton = document.createElement("button");
        editButton.setAttribute("style","cursor:pointer;  position:absolute;right:2%;top:10px; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); border-width:var(--now-button--secondary--border-width,var(--now-button--border-width,var(--now-actionable--border-width,1px))); color:RGB(var(--now-button--secondary--color,var(--now-color--neutral-18,22,27,28))); font-family: var(--now-button--font-family,var(--now-actionable--font-family,var(--now-font-family,\"Source Sans Pro\",Arial,sans-serif))); font-style:var(--now-button--font-style,var(--now-actionable--font-style,normal)); font-weight:var(--now-button--font-weight,var(--now-actionable--font-weight,normal)); font-size:0.85rem; line-weight:1.25;");
        editButton.setAttribute("id","editList");
        editButton.innerHTML = "Edit List";
        document.getElementById("favoriteList").appendChild(editButton);
      }catch(err){}
      isListInEditMode = false;
    }else{
      //open edit mode
      //draw edit inputs
      document.getElementById("bridgePopup").innerHTML = loadFavoritesList(true);
      var newKbaInputDiv = document.createElement("div");
      newKbaInputDiv.setAttribute("id","newKbaInputDiv");
      newKbaInputDiv.setAttribute("style","display:inline-block; margin-bottom:2%; margin-left:10%; width:600px;");
      var newKbaInput = document.createElement("input");
      newKbaInput.setAttribute("type","text");
      newKbaInput.setAttribute("placeholder","KBA ID");
      newKbaInput.setAttribute("id","newKbaInput");
      newKbaInput.setAttribute("style","width: 20%; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif)); color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148)));");
      var newKbaDescription = document.createElement("input");
      newKbaDescription.setAttribute("type","text");
      newKbaDescription.setAttribute("placeholder","KBA Title / Nickname");
      newKbaDescription.setAttribute("style","width: 50%; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); font-family: var(--now-form-field--font-family, var(--now-font-family, \"Source Sans Pro\", Arial, sans-serif)); color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148)));");
      newKbaDescription.setAttribute("id","newKbaDescription");
      var newKbaSubmit = document.createElement("button");
      newKbaSubmit.setAttribute("id","newKbaSubmit");
      newKbaSubmit.setAttribute("style","cursor:pointer; margin-left:1%; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); border-width:var(--now-button--secondary--border-width,var(--now-button--border-width,var(--now-actionable--border-width,1px))); color:RGB(var(--now-button--secondary--color,var(--now-color--neutral-18,22,27,28))); font-family: var(--now-button--font-family,var(--now-actionable--font-family,var(--now-font-family,\"Source Sans Pro\",Arial,sans-serif))); font-style:var(--now-button--font-style,var(--now-actionable--font-style,normal)); font-weight:var(--now-button--font-weight,var(--now-actionable--font-weight,normal)); font-size:0.85rem; line-weight:1.25;");
      newKbaSubmit.innerHTML = "Add KBA";
      newKbaInputDiv.appendChild(newKbaInput);
      newKbaInputDiv.appendChild(newKbaDescription);
      newKbaInputDiv.appendChild(newKbaSubmit);

      var editButton = document.createElement("button");
      editButton.setAttribute("style","cursor:pointer;  position:absolute;right:2%;top:10px;; background-color:RGB(var(--now-button--secondary--background-color--hover,var(--now-color--neutral-3,209,214,214)),var(--now-button--secondary--background-color-alpha--hover,var(--now-button--secondary--background-color-alpha,1))); border-color:RGB(var(--now-button--secondary--border-color,var(--now-color--neutral-7,135,147,148))); border-radius:var(--now-button--secondary--border-radius,var(--now-button--border-radius,var(--now-actionable--border-radius,0))); border-width:var(--now-button--secondary--border-width,var(--now-button--border-width,var(--now-actionable--border-width,1px))); color:RGB(var(--now-button--secondary--color,var(--now-color--neutral-18,22,27,28))); font-family: var(--now-button--font-family,var(--now-actionable--font-family,var(--now-font-family,\"Source Sans Pro\",Arial,sans-serif))); font-style:var(--now-button--font-style,var(--now-actionable--font-style,normal)); font-weight:var(--now-button--font-weight,var(--now-actionable--font-weight,normal)); font-size:0.85rem; line-weight:1.25;");
      editButton.setAttribute("id","editList");
      editButton.innerHTML = "Edit List";

      document.getElementById("bridgePopup").appendChild(newKbaInputDiv);
      document.getElementById("bridgePopup").appendChild(editButton);

      isListInEditMode = true;
    }
  //ignore when clicking on input boxes
  }else if(e.target.id == "newKbaInput" || e.target.id == "newKbaDescription"){

  //Add KBA button
  }else if (e.target.id == "newKbaSubmit"){
    if(document.getElementById("newKbaInput").value!="" && document.getElementById("newKbaDescription").value!= ""){
      addKbaToList(document.getElementById("newKbaInput").value,document.getElementById("newKbaDescription").value);
    }
  //Delete KBA from List
  }else if (e.target.id.toString().toLowerCase().substring(0,10) == "deletekba:"){
    deleteKbaFromList(e.target.id.toString().toLowerCase().substring(10));
  }else{
    isListInEditMode = false;
    try{
      instantKbaDiv.removeChild(document.getElementById("bridgePopup"));
      isBridgePopupOpen = false;      
    }catch(err){}

    try{
      instantKbaDiv.removeChild(document.getElementById("helpPopup"));
      isHelpPopupOpen = false;
    }catch(err){}
    
  }
  
});



window.addEventListener("resize",(event)=>{
  //check screen size to avoid widget staying out of bounds
if(defaultRightPosition.replace("px","") > window.innerWidth){
  defaultRightPosition = fallBackRightPosition;
  document.body.removeChild(instantKbaDiv);
  instantKbaDiv.setAttribute("style","z-index:9999; display:inline-block; vertical-align:baseline; position:absolute; right:"+defaultRightPosition+"; top:"+defaultTopPosition+";");
  localStorage.setItem("instant_Kba_default_position",(defaultRightPosition+","+defaultTopPosition));
  if(caseData != ""){
    document.body.appendChild(instantKbaDiv);
  }
  
}

if(defaultTopPosition.replace("px","") > window.innerHeight){
  defaultTopPosition = fallBackTopPosition
  document.body.removeChild(instantKbaDiv);
  instantKbaDiv.setAttribute("style","z-index:9999; display:inline-block; vertical-align:baseline; position:absolute; right:"+defaultRightPosition+"; top:"+defaultTopPosition+";");
  localStorage.setItem("instant_Kba_default_position",(defaultRightPosition+","+defaultTopPosition));
  if(caseData != ""){
    document.body.appendChild(instantKbaDiv);
  }
}
});
