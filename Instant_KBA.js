// ==UserScript==
// @name     CSM Companion
// @version  1.7.2
// @grant    none
// @match    *://itsm.services.sap/*
// @include  *://itsm.services.sap/*
// @exclude  *://itsm.services.sap/attach_knowledge*
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

var defaultLeftPosition;
var defaultTopPosition;
var screenWidth = window.innerWidth;
var screenHeight = window.innerHeight;

//detect screen siz changes
window.addEventListener("resize",(e)=>{
  adjustPositionAfterResize();
});

//check existing saved position
try{
  if(localStorage.getItem("csm_companion_default_position").length > 0){
    defaultLeftPosition = (localStorage.getItem("csm_companion_default_position").split(",")[0]);
    defaultTopPosition = (localStorage.getItem("csm_companion_default_position").split(",")[1]);

    if(defaultLeftPosition.replaceAll("px","").replaceAll("%","") > screenWidth){
      if(isCompactVersionActive){
        defaultLeftPosition = screenWidth - containerCompactWidth;
      }else{
        defaultLeftPosition = screenWidth - containerFullWidth;
      }      
    }
    if(defaultTopPosition.replaceAll("px","").replaceAll("%","") > screenHeight){
      if(isCompactVersionActive){
        defaultTopPosition = screenHeight - containerCompactHeigth;
      }else{
        defaultTopPosition = screenHeight - containerFullHeigth;
      }
    }
  }else{
    defaultLeftPosition = "3%";
    defaultTopPosition = "52%";
  }

}catch(err){
  defaultLeftPosition = "3%";
  defaultTopPosition = "52%";
}

function adjustPositionAfterResize(){
  console.log("New window width: "+window.innerWidth);
  console.log("previous window width: "+screenWidth);

  var newScreenWidth = window.innerWidth;
  var newScreenHeight = window.innerHeight;
  var widgetLeftPositionInPx = (defaultLeftPosition.replaceAll("%","")/100)*screenWidth;
  var widgetTopPositionInPx = (defaultTopPosition.replaceAll("%","")/100)*screenHeight;
  var widgetHorizontalSizeOffset = (isCompactVersionActive)?containerCompactWidth:containerFullWidth;
  var widgetVerticalSizeOffset = (isCompactVersionActive)?containerCompactHeigth:containerFullHeigth;

  //TO DO
  if((widgetLeftPositionInPx+widgetHorizontalSizeOffset) > newScreenWidth){
    if(isCompactVersionActive){
      defaultLeftPosition = (((newScreenWidth - containerCompactWidth)/newScreenWidth)*100)+"%";
      //defaultLeftPosition = (newScreenWidth - containerCompactWidth)+"px";
    }else{
      defaultLeftPosition = (((newScreenWidth - containerFullWidth)/newScreenWidth)*100)+"%";
    }      
  }
  if((widgetTopPositionInPx+widgetVerticalSizeOffset) > newScreenHeight){
    if(isCompactVersionActive){
      defaultTopPosition = (((newScreenHeight - containerCompactHeigth)/newScreenHeight)*100)+"%";
    }else{
      defaultTopPosition = (((newScreenHeight - containerFullHeigth)/newScreenHeight)*100)+"%";
    }
  }
  localStorage.setItem("csm_companion_default_position",(defaultLeftPosition+","+defaultTopPosition));
  document.getElementById("checkerDiv").style.left = defaultLeftPosition;
  document.getElementById("checkerDiv").style.top = defaultTopPosition;
}

var isCompactVersionActive;
//check existing saved mode
try{
  if(localStorage.getItem("csm_companion_default_mode") != null){
    isCompactVersionActive = (localStorage.getItem("csm_companion_default_mode") === "true");
  }else{
    isCompactVersionActive = false;
  }
}catch(err){
  isCompactVersionActive = false;
}
var pulseCheckerDiv = document.createElement("div");
pulseCheckerDiv.setAttribute("id","checkerDiv");
document.body.appendChild(pulseCheckerDiv);
var pulseData = "";
var kcsCategorizeComplete = false;
var kcsInvestigateComplete = false;
var kcsCategorizationComplete = false;
var pulseCsmInsights = [];
var kbaCsmInsights = [];
var otherCsmInsights = [];
var aiCsmInsights = [];
var isKbaAttached = false;
var scriptReceivedCaseData;
var containerFullHeigth = 400;
var containerCompactHeigth = 60;
var containerFullWidth = 250;
var containerCompactWidth = 330;

//Set CSM Insight add function
function pushCsmInsight(insight, type){

  switch (type){
    case "pulse":
      if(pulseCsmInsights.length == 0){
        pulseCsmInsights.push("• "+insight);
      }else{
        var insightExists = false;
        for(var i=0; i<pulseCsmInsights.length;i++){
          if(pulseCsmInsights[i].indexOf(insight)>=0){
            insightExists = true;
          }
        }
        if(!insightExists){
          pulseCsmInsights.push("• "+insight);
        }
      }
      break;
    case "kba":
      if(kbaCsmInsights.length == 0){
        kbaCsmInsights.push("• "+insight);
      }else{
        var insightExists = false;
        for(var i=0; i<kbaCsmInsights.length;i++){
          if(kbaCsmInsights[i].indexOf(insight)>=0){
            insightExists = true;
          }
        }
        if(!insightExists){
          kbaCsmInsights.push("• "+insight);
        }
      }
      break;
    case "others":
      if(otherCsmInsights.length == 0){
        otherCsmInsights.push("• "+insight);
      }else{
        var insightExists = false;
        for(var i=0; i<otherCsmInsights.length;i++){
          if(otherCsmInsights[i].indexOf(insight)>=0){
            insightExists = true;
          }
        }
        if(!insightExists){
          otherCsmInsights.push("• "+insight);
        }
      }
      break;
    case "ai":
      if(aiCsmInsights.length == 0){
        aiCsmInsights.push("• "+insight);
      }else{
        var insightExists = false;
        for(var i=0; i<aiCsmInsights.length;i++){
          if(aiCsmInsights[i].indexOf(insight)>=0){
            insightExists = true;
          }
        }
        if(!insightExists){
          aiCsmInsights.push("• "+insight);
        }
      }
      break;
  }
}

//create insights list box
function openCsmInsights(insights){
    let insightsPopup = document.createElement("div");
    insightsPopup.setAttribute("style","cursor:default; position:absolute; z-index:99; display:block; border-radius:15px; width:800px; heigth:800px; bottom:0%; left:102%; background-color:rgba(0, 0, 0, 0.65); color:white; padding:20px;");
    insightsPopup.setAttribute("id", "insightsPopup");
    insightsPopup.innerHTML = "<button style=\"cursor:pointer; border: none; float:right; display:block; position:absolute; right:5%; width:10px; height:10px; border-radius:28px 28px 0px 0px; background-color:rgba(0, 0, 0, 0.35); color:white;\" id=\"closeInsights\" title=\"Close Insights\">X</button>";
    insightsPopup.innerHTML += "<small style=\"margin-bottom:0px;\"><h1>CSM Insights</h1></small>"
    insightsPopup.innerHTML += insights;
  if(!isInsightsOpen){
    pulseCheckerDiv.appendChild(insightsPopup);
    isInsightsOpen = true;
  }else{
    try{
      document.getElementById("checkerDiv").removeChild(document.getElementById("insightsPopup"));
    }catch(err){
      //element may already be removed due to toggling full/compact modes
      isInsightsOpen = false
    }
    isInsightsOpen = false;
  }
  
}

//Set draggable box
var container = document.getElementById("checkerDiv");
var initialMousePosition = [];
var bounds;
var relativeMouseX;
var relativeMouseY; 
var isInsightsOpen = false;

function handleMouseMove(event){
  event.preventDefault();
  onMouseDrag(event.x,event.y);
}

function onMouseDrag(movementX, movementY){
  var containerStyle = window.getComputedStyle(container);
  var lefPosition = parseInt(containerStyle.left);
  var topPosition = parseInt(containerStyle.top);

  container.style.position = "absolute";
  if(!isCompactVersionActive){
    if((movementX-relativeMouseX+containerFullWidth)<=window.innerWidth && (movementX-relativeMouseX)>0){
      container.style.left = (((movementX-relativeMouseX)/window.innerWidth)*100)+"%";
      defaultLeftPosition = (((movementX-relativeMouseX)/window.innerWidth)*100)+"%";
    }
    if((movementY-relativeMouseY+containerFullHeigth)<=window.innerHeight && (movementY-relativeMouseY)>0){
      container.style.top = (((movementY-relativeMouseY)/window.innerHeight)*100)+"%";
      defaultTopPosition = (((movementY-relativeMouseY)/window.innerHeight)*100)+"%";
    }
  }else{
    if((movementX-relativeMouseX+containerCompactWidth)<=window.innerWidth && (movementX-relativeMouseX)>0){
      container.style.left = (((movementX-relativeMouseX)/window.innerWidth)*100)+"%";
      defaultLeftPosition = (((movementX-relativeMouseX)/window.innerWidth)*100)+"%";
    }
    if((movementY-relativeMouseY+containerCompactHeigth)<=window.innerHeight && (movementY-relativeMouseY)>0){
      container.style.top = (((movementY-relativeMouseY)/window.innerHeight)*100)+"%";
      defaultTopPosition = (((movementY-relativeMouseY)/window.innerHeight)*100)+"%";
    }
  }
  localStorage.setItem("csm_companion_default_position",(defaultLeftPosition+","+defaultTopPosition));
}

container.addEventListener("mousedown", (e)=>{
  if(e.target.id == "insights" || e.target.id == "insightsText"){

    if(pulseCsmInsights.length>0 || kbaCsmInsights.length>0 || otherCsmInsights.length>0 || aiCsmInsights.length>0){
      var insightString = "<big>";
      if(pulseCsmInsights.length>0){
        insightString = insightString + "<b>PULSE</b><br>";
        insightString = insightString + (pulseCsmInsights.join("<br>")) + "<br><br>";
      }
      if(kbaCsmInsights.length>0){
        insightString = insightString + "<b>KBA</b><br>";
        insightString = insightString + (kbaCsmInsights.join("<br>")) + "<br><br>";
      }
      if(aiCsmInsights.length>0){
        insightString = insightString + "<b>AI (experimental)</b><br>";
        insightString = insightString + (aiCsmInsights.join("<br>")) + "<br><br>";
      }
      if(otherCsmInsights.length>0){
        insightString = insightString + "<b>OTHERS</b><br>";
        insightString = insightString + (otherCsmInsights.join("<br>"));
      }
      insightString+="</big>"
      //alert("<b>CSM Insights (Beta)</b><br><br>"+insightString+"</small>");
      openCsmInsights(insightString);
    }else{
      //alert("No CSM Insights :)");
    }
  }else if(e.target.id == "toggleCompact"){
    isCompactVersionActive = !isCompactVersionActive;
    localStorage.setItem("csm_companion_default_mode",isCompactVersionActive);
    setScriptUI(scriptReceivedCaseData);
    //toggling modes closes the insight append, so we signal it is closed
    isInsightsOpen = false;
    //adjust position when toggling back to full mode
    if(!isCompactVersionActive){
      setTimeout(() => {      
        var containerStyle = window.getComputedStyle(container);
        container.style.position = "absolute";
        defaultTopPosition = container.style.top;
        localStorage.setItem("csm_companion_default_position",(defaultLeftPosition+","+defaultTopPosition));
        if ((parseInt(containerStyle.top) + parseInt(containerFullHeigth)) > window.innerHeight){
          container.style.top = (window.innerHeight - containerFullHeigth)+"px";
          defaultTopPosition = container.style.top;
          localStorage.setItem("csm_companion_default_position",(defaultLeftPosition+","+defaultTopPosition));
        }
      }, 100);
    }
          
  }else if(e.target.id == "closeInsights"){
    openCsmInsights(insightString);
  }else{
    bounds = container.getBoundingClientRect();
    relativeMouseX = e.clientX - bounds.left;
    relativeMouseY = e.clientY - bounds.top;
    document.addEventListener("mousemove", handleMouseMove);
  }
  
});

document.addEventListener("mouseup",()=>{
  document.removeEventListener("mousemove", handleMouseMove);
});



///////////////////////////////////////////////////////////////////////////////////////////////
//                             CSM AI INSIGHTS - EXPERIMENTAL                                //
///////////////////////////////////////////////////////////////////////////////////////////////

async function triggerAI(prompt){
    var aiResponse;
    try {
      const args = {
        model: "llm_service_model",
        parameters: {
          deployment_id: "gpt-4-32k",
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          max_tokens: 2500,
          temperature: 0.0,
          frequency_penalty: 0,
          presence_penalty: 0,
          stop: "null",
        },
      };
  
      const res = await top.ise.ai.request(args);
      if (res.error) throw res.error;
  
      aiResponse = res.choices[0].message.content;
    } catch (error) {
      aiResponse = "AI is currently unavailable, please try again later";
      console.log(error);
    }
    return aiResponse;
}

async function processAiInsights(pulse, attachments, description){
  //initial prompt
  var aiPrompt = "Respond the following series of queries in the sequence, which are separated by ||, separating the answers with a comma:";
  //numbered steps
  if(trimPulseField(pulse.steps_to_reproduce).length>2 && trimPulseField(pulse.steps_to_reproduce).toLowerCase()!= "n/a"){
      //if the numbering is done through Case Assistant, it comes as <li> instead of a numbered list, so we force a replace to "1." since it is a numbered list
      if(trimPulseField(pulse.steps_to_reproduce).indexOf("<li>") >= 0){
        aiPrompt += "Respond with 'true' or 'false' if the following text contains at least one numbered step:"+trimPulseField(pulse.steps_to_reproduce).replaceAll("<li>","1.");
      }else{
        aiPrompt += "Respond with 'true' or 'false' if the following text contains at least one numbered step:"+trimPulseField(pulse.steps_to_reproduce);
      }
    
  }else{
    //dummy prompt to force a 'true' and not push insight
    aiPrompt += "1 plus 1 equals 2";
  }
  //attachments in data collected
  let attachmentCount = 0;
  //Count all attachments (except IncidentContext.zip)
  for(const a of Object.values(attachments)){
    if(a.filename.toLowerCase() != "incidentcontext.zip"){
      attachmentCount++;
    }
  }
  //If there is any attachment added, try to check if they are mentioned in pulse
  if(attachmentCount > 0){
    aiPrompt += "||Imagine that you are an SAP support engineer, and you are reading the analysis of a support case made by a colleague. Respond with 'true' or 'false' if the following text from the analysis contains any mention of a document or screenshot or image that was attached or is an attachment:"+trimPulseField(pulse.data_collected);
  }else{
    //dummy prompt to force a 'true' and not push insight
    aiPrompt += "|| 1 plus 1 equals 2";
  }

  //error message in description
  var decodedDescription = description.replaceAll("&#34;","\"").replaceAll("&#39;","'");
  aiPrompt+= "||Respond with 'true' or 'false' if the following text has an error message or a sentence between quotes, either single or double:"+decodedDescription;
  var aiAnswer = await triggerAI(aiPrompt);
  var insightResults = aiAnswer.split(",");

  //pulse numbered steps
  if(insightResults[0].toLowerCase() == "false"){
    pushCsmInsight("It seems that the steps to reproduce in the Pulse summary are not numbered. It is recommended to number the list of steps taken","ai");
  }

  //attachment mentioned in data collected
  if(insightResults[1].toString().trim().toLowerCase() == "false"){
    pushCsmInsight("It seems that there is at least one attachment in this case. Please ensure that the same is mentioned in the Pulse summary.","ai");
  }

  //error message in description
  if(insightResults[2].toString().trim().toLowerCase() == "true"){
    pushCsmInsight("It seems that the case description contains a specific error/system message. Please ensure the same is present in the Pulse symptom section","ai");
  }
}

//Setting content when case is opened
top.ise.case.onUpdate2(
    async (receivedCaseData) => {
      if(receivedCaseData.types[0] != "newcase"){
        if(receivedCaseData.types[0] == "knowledgematches"){
          //TODO: kba suggestion insights
        }else{
            scriptReceivedCaseData = receivedCaseData;
            pulseCheckerDiv.innerHTML = "";
            setScriptUI(receivedCaseData);
        }
      }
      
  },
  //this seems to be what requests communication data from case
  ["communication","headers","knowledgematches","attachments"]);

  //Function to set all the UI when case data is received. This is set in a separated function so it can be called to toggle between full and compact versions
  function setScriptUI(receivedCaseData){
    //clear any previous data
    pulseCsmInsights = [];
    otherCsmInsights = [];
    kbaCsmInsights = [];
    aiCsmInsights = [];

    //when a case is open, query the Pulse data
    try{
      pulseData = API.Pulse.get(receivedCaseData.id).then(async(pulse)=>{
      //Clear any previous data
      //Hide if no case is open
      if(receivedCaseData.types[0] == "nocase"){
        pulseCheckerDiv.setAttribute("style","display:none;");
        //closing the case closes the insight append, so we signal it is closed
        isInsightsOpen = false;
      }else if(!isCompactVersionActive){
        //Full version
        //Minimize button
        console.log("setting UI with left position as: "+defaultLeftPosition);
        pulseCheckerDiv.innerHTML = "<div style=\"text-align: center; color: white;\"><button style=\"cursor:pointer; border: none; display:block; width:99%; margin-left:0.5%; height:3%; border-radius:28px 28px 0px 0px; background-color:rgba(0, 0, 0, 0.35); color:white;\" id=\"toggleCompact\" title=\"Compact Version\">⤓</button><h2 style=\"margin-top:4%; margin-bottom:0%;\">CSM Companion</h2><h4 style=\"margin-bottom:4%; margin-top:0%;\">"+receivedCaseData.headers.data.number+"</h4><h3 style=\"margin-bottom:0%;\">Pulse Completion</h3></div>";
        pulseCheckerDiv.setAttribute("style","cursor:move; display:block; position:absolute; z-index:99 ;top:"+defaultTopPosition+"; left:"+defaultLeftPosition+"; width:"+containerFullWidth+"px; height:"+containerFullHeigth+"px; background-color:rgba(0, 0, 0, 0.65); border-radius:25px;");
        pulseCheckerDiv.setAttribute("id","checkerDiv");
      }else{
        //Compact version
        pulseCheckerDiv.innerHTML = "<div style=\"display:inline-block; vertical-align: baseline; color: white;\"><button style=\"cursor:pointer; border: none; border-radius:10px 0px 0px 0px; width:20px; height:20px; float:left; margin-right:8px; background-color:rgba(0, 0, 0, 0.35); color:white;\" id=\"toggleCompact\" title=\"Full-Size Version\">⤒</button><h3 style=\"display:inline-block; margin-top:-10%; margin-bottom:4%; margin-left:18%; margin-right:5%;\">CSM Companion</h3></div>";
        pulseCheckerDiv.setAttribute("style","cursor:move; display:block; position:absolute; z-index:99 ;top:"+defaultTopPosition+"; left:"+defaultLeftPosition+"; width:"+containerCompactWidth+"px; height:"+containerCompactHeigth+"px; background-color:rgba(0, 0, 0, 0.65); border-radius:10px;");
        pulseCheckerDiv.setAttribute("id","checkerDiv");
      }

      //If categorization is "service request", pulse is not required
      if(receivedCaseData.headers.data.resolutionError.category == "service_request"){
        kcsCategorizeComplete = true;
        kcsInvestigateComplete = true;
        if(!isCompactVersionActive){
          //Full version
          var serviceRequestDiv = document.createElement("h4");
          serviceRequestDiv.setAttribute("style","text-align: center; color: PaleGreen; margin: 1%;");
          serviceRequestDiv.innerHTML = "Pulse Not Required (<abbr title=\"For Service Request cases, Pulse is not mandatory\"> ? </abbr>)";
          pulseCheckerDiv.appendChild(serviceRequestDiv);
        }else{
          //Compact version
          var serviceRequestDiv = document.createElement("div");
          serviceRequestDiv.setAttribute("style","display:inline-block; background-color: PaleGreen; line-height:38px; vertical-align:-3px; width:25px; height:25px; border-radius:13px;");
          serviceRequestDiv.setAttribute("title","For Service Request cases, Pulse is not mandatory");
          serviceRequestDiv.innerHTML="<h3 style=\"text-align:center; vertical-align:top; color:white;\" title=\"Pulse Status\">P</h3>";
          pulseCheckerDiv.appendChild(serviceRequestDiv);
        }

        //CSM PULSE INSIGHTS
        //Service Request Pulse Completion
        pushCsmInsight("Pulse completion is still suggested for Service Request Cases","pulse");

      }else{
        //CSM AI INSIGHTS
        try{
          processAiInsights(pulse, receivedCaseData.attachments.data, receivedCaseData.communication.data.description);
        }catch(err){

        }
        //CSM PULSE INSIGHTS
        //Pulse last update
        if(pulse != "New"){
          var updateDate = new Date(pulse.sys_updated_on+" UTC");
          var currentDate = new Date();
          //Calculate difference in ms then convert to hours   
          var updateTimeDifference = Math.abs(((updateDate.getTime() - currentDate.getTime())/(1000*60*60))); 
          if(updateTimeDifference >= 48){
            pushCsmInsight("Pulse has not been updated in the last 48 hours. Check if the existing pulse can be improved with new info.","pulse");
          }
          //Pulse update user (disconsider when pulse change comes from Case Assistant)
          if(receivedCaseData.headers.data.processor != pulse.sys_updated_by && pulse.sys_updated_by!= "INT_ISE2SN"){
            pushCsmInsight("Pulse was last updated by a different user. Check if the existing pulse can be improved with new info.","pulse");
          }
          //Check Pulse mandatory fields
          verifyCategorizeSection(pulse);
          verifyInvestigateSection(pulse);
          if(!kcsCategorizeComplete || !kcsInvestigateComplete){
            pushCsmInsight("For Pulse completion, it is mandatory to complete at least the Symptom and either Data Collected, Research or Research (Internal)","pulse");
          }
        }

        if(!isCompactVersionActive){
          //Full Version
          //verify and list each section of pulse
          //Categorization
          var categorizeDiv = document.createElement("h4");
          categorizeDiv.setAttribute("style","text-align: center; color: white; margin: 1%;");
          try{
            categorizeDiv.innerHTML = "Categorize: "+verifyCategorizeSection(pulse)+"/5"+((!kcsCategorizeComplete)?" (<abbr style=\"text-decoration: none\" title=\"For KCS adoption, Symptom is mandatory\"> ⚠ </abbr>)":"");
            if(verifyCategorizeSection(pulse)==5){
              categorizeDiv.setAttribute("style","text-align: center; color: PaleGreen; margin: 1%;");
            }else if(verifyCategorizeSection(pulse)>0){
              categorizeDiv.setAttribute("style","text-align: center; color: Khaki; margin: 1%;");
            }else{
              categorizeDiv.setAttribute("style","text-align: center; color: LightCoral; margin: 1%;");
            }
          }catch(err){
            categorizeDiv.setAttribute("style","text-align: center; color: LightCoral; margin: 1%;");
            categorizeDiv.innerHTML = "Categorize: 0/5"+((!kcsCategorizeComplete)?" (<abbr title=\"For KCS adoption, Symptom is mandatory\"> ⚠ </abbr>)":"");
          }
          pulseCheckerDiv.appendChild(categorizeDiv);

          //Investigate
          var investigateDiv = document.createElement("h4");
          investigateDiv.setAttribute("style","text-align: center; color: white; margin: 1%;");
          try{
            investigateDiv.innerHTML = "Investigate: "+verifyInvestigateSection(pulse)+"/3"+((!kcsInvestigateComplete)?" (<abbr style=\"text-decoration: none\" title=\"For KCS adoption, at least one field must be filled\"> ⚠ </abbr>)":"");
            if(verifyInvestigateSection(pulse)==3){
              investigateDiv.setAttribute("style","text-align: center; color: PaleGreen; margin: 1%;");
            }else if(verifyInvestigateSection(pulse)>0){
              investigateDiv.setAttribute("style","text-align: center; color: Khaki; margin: 1%;");
            }else{
              investigateDiv.setAttribute("style","text-align: center; color: LightCoral; margin: 1%;");
            }
          }catch(err){
            investigateDiv.setAttribute("style","text-align: center; color: LightCoral; margin: 1%;");
            investigateDiv.innerHTML = "Investigate: 0/3"+((!kcsInvestigateComplete)?" (<abbr style=\"text-decoration: none\" title=\"For KCS adoption, at least one field must be filled\"> ⚠ </abbr>)":"");
          }
          pulseCheckerDiv.appendChild(investigateDiv);

          //Resolution
          var resolutionDiv = document.createElement("h4");
          resolutionDiv.setAttribute("style","text-align: center; color: white;  margin: 1%;");
          try{
            resolutionDiv.innerHTML = "Resolution: "+verifyResolutionSection(pulse)+"/4";
            if(verifyResolutionSection(pulse)==4){
              resolutionDiv.setAttribute("style","text-align: center; color: PaleGreen; margin: 1%;");
            }else if(verifyResolutionSection(pulse)>0){
              resolutionDiv.setAttribute("style","text-align: center; color: Khaki; margin: 1%;");
            }else{
              resolutionDiv.setAttribute("style","text-align: center; color: LightCoral; margin: 1%;");
            }
          }catch(err){
            resolutionDiv.setAttribute("style","text-align: center; color: LightCoral; margin: 1%;");
            resolutionDiv.innerHTML = "Resolution: 0/4";
          }
          pulseCheckerDiv.appendChild(resolutionDiv);
        }else{
          //Compact Version
          var pulseCompletionDiv = document.createElement("div");
          try{
            if(verifyCategorizeSection(pulse)==5 && verifyInvestigateSection(pulse)==3 && verifyResolutionSection(pulse)>=2){
              pulseCompletionDiv.setAttribute("style","line-height:38px; vertical-align:-3px; display:inline-block; background-color: PaleGreen; width:25px; height:25px; border-radius:13px;");
            }else if(verifyCategorizeSection(pulse)>0 && verifyInvestigateSection(pulse)>0 && verifyResolutionSection(pulse)>0 && (kcsInvestigateComplete && kcsCategorizeComplete)){
              pulseCompletionDiv.setAttribute("style","line-height:38px; vertical-align:-3px; display:inline-block; background-color: Khaki; width:25px; height:25px; border-radius:13px;");
            }else{
              pulseCompletionDiv.setAttribute("style","line-height:38px; vertical-align:-3px; display:inline-block; background-color: LightCoral; width:25px; height:25px; border-radius:13px;");
            }
            pulseCompletionDiv.innerHTML="<h3 style=\"text-align:center; vertical-align:top; color:white;\" title=\"Pulse Status\">P</h3>";
            pulseCompletionDiv.setAttribute("title","Pulse Status - Categorize: "+verifyCategorizeSection(pulse)+"/5, Investigate: "+verifyInvestigateSection(pulse)+"/3, Resolution: "+verifyResolutionSection(pulse)+"/4");
            pulseCheckerDiv.appendChild(pulseCompletionDiv);
          }catch(err){
            pulseCompletionDiv.setAttribute("style","line-height:38px; vertical-align:-3px; display:inline-block; background-color: LightCoral; width:25px; height:25px; border-radius:13px;");
            pulseCompletionDiv.innerHTML="<h3 style=\"text-align:center; vertical-align:top; color:white;\" title=\"Pulse Status\">P</h3>";
            pulseCompletionDiv.setAttribute("title","Pulse Status - Categorize: 0/5, Investigate: 0/3, Resolution: 0/4");
            pulseCheckerDiv.appendChild(pulseCompletionDiv);
          }

        }
      }

      //Error Categorization check
      var errorCategorizationDiv = document.createElement("div");
      if(!isCompactVersionActive){
        //Full version
        errorCategorizationDiv.setAttribute("style","text-align: center; color: white;");
        errorCategorizationDiv.innerHTML = "<h3 style=\"margin-bottom:0%;\">Error Categorization</h3>";
        var errorCategorizationIndicatorDiv = document.createElement("h4");
        if(receivedCaseData.headers.data.resolutionError.subcategory == ""){
          //check categories that do not have subcategory
          if(receivedCaseData.headers.data.resolutionError.category == "customer_partner_issue" || receivedCaseData.headers.data.resolutionError.category == "database_inconsistency" || receivedCaseData.headers.data.resolutionError.category == "3party_partner_issue"){
            errorCategorizationIndicatorDiv.setAttribute("style","color: PaleGreen; margin-top:0%;");
            errorCategorizationIndicatorDiv.innerHTML = "Complete";
            kcsCategorizationComplete = true;
          }else{
            errorCategorizationIndicatorDiv.setAttribute("style","color: LightCoral; margin-top:0%;");
            errorCategorizationIndicatorDiv.innerHTML = "Incomplete";
            kcsCategorizationComplete = false;
          }
        }else{
            errorCategorizationIndicatorDiv.setAttribute("style","color: PaleGreen; margin-top:0%;");
            errorCategorizationIndicatorDiv.innerHTML = "Complete";
            kcsCategorizationComplete = true;
        }
        errorCategorizationDiv.appendChild(errorCategorizationIndicatorDiv);
        pulseCheckerDiv.appendChild(errorCategorizationDiv);
      }else{
        //Compact version
        if(receivedCaseData.headers.data.resolutionError.subcategory == ""){
          //check categories that do not have subcategory
          if(receivedCaseData.headers.data.resolutionError.category == "customer_partner_issue" || receivedCaseData.headers.data.resolutionError.category == "database_inconsistency" || receivedCaseData.headers.data.resolutionError.category == "3party_partner_issue"){
            errorCategorizationDiv.setAttribute("style","margin-left:10px; line-height:38px; vertical-align:-3px; display:inline-block; background-color: PaleGreen; width:25px; height:25px; border-radius:13px;");
            kcsCategorizationComplete = true;
          }else{
            errorCategorizationDiv.setAttribute("style","margin-left:10px; line-height:38px; vertical-align:-3px; display:inline-block; background-color: LightCoral; width:25px; height:25px; border-radius:13px;");
            kcsCategorizationComplete = false;
          }
        }else{
          errorCategorizationDiv.setAttribute("style","margin-left:10px; line-height:38px; vertical-align:-3px; display:inline-block; background-color: PaleGreen; width:25px; height:25px; border-radius:13px;");
          kcsCategorizationComplete = true;
        }

        errorCategorizationDiv.innerHTML="<h3 style=\"text-align:center; vertical-align:top; color:white;\" title=\"Error Categorization\">E</h3>";
        errorCategorizationDiv.setAttribute("title", (kcsCategorizationComplete)?"Error Categorization - Complete":"Error Categorization - Incomplete");
        pulseCheckerDiv.appendChild(errorCategorizationDiv);

      }

      //CSM PULSE INSIGHTS
      //How-to redirect
      if(receivedCaseData.headers.data.resolutionError.category == "customer_partner_issue" && (receivedCaseData.headers.data.resolutionError.subcategory == "how_to_request" || receivedCaseData.headers.data.resolutionError.subcategory == "consulting_implementation_request")){
        pushCsmInsight("Case is eligible for How-To Redirect process according to the current error categorization. Please proceed with the How-To redirect process.","others")
      }

      //Swarming Check
      var swarmCheckDiv = document.createElement("div");
      if(!isCompactVersionActive){
        //Full version
        swarmCheckDiv.setAttribute("style","text-align: center; color: white;");
        swarmCheckDiv.innerHTML = "<h3 style=\"margin-bottom:0%;\">Swarming</h3>";
        var swarmIndicatorDiv = document.createElement("h4");
        //Check if swarm exists by searching in the pulse research (internal) section
        try{
          if(pulse.research_internal.toString().toLowerCase().indexOf("-- swarm") != -1){
            swarmIndicatorDiv.setAttribute("style","color: PaleGreen; margin-top:0%;");
            swarmIndicatorDiv.innerHTML = "Swarm Created";
          }else{
            swarmIndicatorDiv.setAttribute("style","color: Khaki; margin-top:0%;");
            swarmIndicatorDiv.innerHTML = "No Swarm Detected";
          }
        }catch(err){
          swarmIndicatorDiv.setAttribute("style","color: Khaki; margin-top:0%;");
          swarmIndicatorDiv.innerHTML = "No Swarm Detected";
        }
        swarmCheckDiv.appendChild(swarmIndicatorDiv);
        pulseCheckerDiv.appendChild(swarmCheckDiv);
      }else{
        //Compact version
        try{
          if(pulse.research_internal.toString().toLowerCase().indexOf("-- swarm") != -1){
            swarmCheckDiv.setAttribute("style","margin-left:10px; line-height:38px; vertical-align:-3px; display:inline-block; background-color: PaleGreen; width:25px; height:25px; border-radius:13px;");
            swarmCheckDiv.setAttribute("title", "Swarming Detected");
          }else{
            swarmCheckDiv.setAttribute("style","margin-left:10px; line-height:38px; vertical-align:-3px; display:inline-block; background-color: Khaki; width:25px; height:25px; border-radius:13px;");
            swarmCheckDiv.setAttribute("title", "No Swarming Detected");
          }
        }catch(err){
          swarmCheckDiv.setAttribute("style","margin-left:10px; line-height:38px; vertical-align:-3px; display:inline-block; background-color: Khaki; width:25px; height:25px; border-radius:13px;");
          swarmCheckDiv.setAttribute("title", "No Swarming Detected");
        }
        swarmCheckDiv.innerHTML="<h3 style=\"text-align:center; vertical-align:top; color:white;\" title=\"Swarming\">S</h3>";
        pulseCheckerDiv.appendChild(swarmCheckDiv);
      }

    //CSM PULSE INSIGHTS - check if pulse was updated after customer returned
    var lastCustomerResponseTime;
    for(var i=(receivedCaseData.communication.data.memos.length-1); i>=0;i--){
      //Check for the latest reply from customer
      if(receivedCaseData.communication.data.memos[i].memoType == "Info to SAP"){
        lastCustomerResponseTime = receivedCaseData.communication.data.memos[i].Timestamp;
        break;
      }
    }
    var pulseUpdateDate = new Date(pulse.sys_updated_on+" UTC");
    var replyDate = new Date(lastCustomerResponseTime+" UTC");
    if(replyDate > pulseUpdateDate){
      pushCsmInsight("Pulse was not yet updated after the latest customer note. Please check whether the Pulse analysis can be improved.","pulse");
    }

    //CSM INCIDENT INSIGHTS - Check if pulse was updated after incident update
    var lastIncidentResponsetime;
    for(var i=(receivedCaseData.communication.data.memos.length-1); i>=0;i--){
      if(receivedCaseData.communication.data.memos[i].type == "u_work_notes_incident"){
        if(receivedCaseData.communication.data.memos[i].text.toString().toLowerCase().indexOf(" resolution category: ")>=0){
          lastIncidentResponsetime = receivedCaseData.communication.data.memos[i].Timestamp;
          break;
        }
      }
    }
    var incidentDate = new Date(lastIncidentResponsetime+" UTC");
    if(incidentDate > pulseUpdateDate){
      pushCsmInsight("Pulse was not yet updated after the latest resolution on the associated incident. Please check if Pulse can be improved.","pulse");
    }

    //CSM KBA INSIGHTS - check if the last KBA was attached more than 5 days ago
    var lastKbaAdded;
    try{
      for(var i=(receivedCaseData.communication.data.memos.length-1); i>=0;i--){
        //Check for the latest reply from customer
        if(receivedCaseData.communication.data.memos[i].text.toString().toLowerCase().indexOf(" has been attached - ")>=0){
          lastKbaAdded = receivedCaseData.communication.data.memos[i].Timestamp;
          break;
        }
      }
      var lastKbaDate = new Date(lastKbaAdded+" UTC");
      var currentDate = new Date();
      //Calculate difference in ms then convert to hours   
      var updateTimeDifference = Math.abs(((lastKbaDate.getTime() - currentDate.getTime())/(1000*60*60)));
      if(updateTimeDifference > 120){
        pushCsmInsight("No KBA has been attached in the last 5 days. Please check whether all relevant KBAs are attached.","kba");
      }
    }catch(err){ 
      //exception triggered when there is a corrupt memo coming from SNow
    }

    //CSM KBA INSIGHTS - Check if any KBA is attached to the case
    //CSM KBA INSIGHTS - check if there are any currently attached KBAs by the processor
    //CSM KBA INSIGHTS - check if KBA attached to the case is mentioned in the pulse
    let kbaAddBalace = 0;
    let processorKbaAddBalance = 0;
    let kbasAttached = [];
    //count KBAs added and KBAs removed, then compare the numbers to check if a KBA is attached
    try{
      for(let i=0; i<receivedCaseData.communication.data.memos.length;i++){
        if(receivedCaseData.communication.data.memos[i].text.toString().toLowerCase().indexOf(" has been attached - ")>=0){
          kbaAddBalace++;
          //the author of a case note (such as KBA add notes) comes as "name (i-user)", so we split twice to get only the i-user and compare to the processor
          try{
            if((receivedCaseData.communication.data.memos[i].userName.split("(")[1].split(")")[0]) == receivedCaseData.headers.data.processor){
              processorKbaAddBalance++;
            }        
            //collect the KBA ID (splitting the html reveals the numeric KBA ID, which can be searched in pulse. Splitting by " leaves the ID on index 3)
            //exclude bridge KBAs
            if(["2531750","2576522","2537493","2531712","2973358","2537448","2543549","2531826","2543587","2531827","2531921","2531650","2531747","2528300","2541693","2541754","2532334","2532326","2531828","2527097","3488027","2531864","2572475","2532347"].indexOf(receivedCaseData.communication.data.memos[i].html.split('\"')[3].slice(3))<0){
              kbasAttached.push(receivedCaseData.communication.data.memos[i].html.split('\"')[3]);
            }
          }catch(err){
            //SNow does not include the KBA name in the memo when the KBA is created from that case (memo appears as "Knowledge Article XYZ has been attached - 0 -")
            //This catch avoids an exception that breaks the rest of the execution
          } 
          
        }else if(receivedCaseData.communication.data.memos[i].text.toString().toLowerCase().indexOf(" has been removed.")>=0){
          kbaAddBalace--;
          try{
            if((receivedCaseData.communication.data.memos[i].userName.split("(")[1].split(")")[0]) == receivedCaseData.headers.data.processor){
              processorKbaAddBalance--;
            }
            //collect the KBA ID and remove it from the added KBA IDs array
            kbasAttached = kbasAttached.filter(e => e != receivedCaseData.communication.data.memos[i].html.split('\"')[3]);
          }catch(err){
            //SNow does not include the KBA name in the memo when the KBA is created from that case (memo appears as "Knowledge Article XYZ has been attached - 0 -")
            //This catch avoids an exception that breaks the rest of the execution
          }

        }
      }
      //CSM INSIGHTS - check if KBAs attached are referenced in pulse
      var kbasFound = 0;
      for(var i=0; i<kbasAttached.length;i++){
        //check if pulse research of research internal has the KBA ID (removing the 3 leading zeros)
        if(pulse.research.indexOf(kbasAttached[i].slice(3)) >= 0 || pulse.research_internal.indexOf(kbasAttached[i].slice(3)) >= 0){
          kbasFound++;
        }
      }
      if(kbasFound != kbasAttached.length){
        pushCsmInsight("It seems that one or more KBAs attached to the case are not mentioned in the Pulse summary. Please check whether all relevant KBAs are mentioned.","kba");
      }
      //CSM INSIGHTS - check if there are any currently attached KBAs by the processor
      if(processorKbaAddBalance<=0){
        pushCsmInsight("No KBA seems to have been attached by the current processor of this case. Please check if all relevant KBAs are attached.","kba");
      }
      //At the end if balance >0, there is a KBA added
      var kbaCheckDiv = document.createElement("div");
    
      if(!isCompactVersionActive){
        //Full version
        kbaCheckDiv.setAttribute("style","text-align: center; color: white;");
        kbaCheckDiv.innerHTML = "<h3 style=\"margin-bottom:0%;\">KBA</h3>";
        var kbaIndicatorDiv = document.createElement("h4");
        if(kbaAddBalace>0){
          isKbaAttached = true;
          kbaIndicatorDiv.setAttribute("style","color: PaleGreen; margin-top:0%;");
          kbaIndicatorDiv.innerHTML = "KBA Attached";
        }else{
          isKbaAttached = false;
          kbaIndicatorDiv.setAttribute("style","color: LightCoral; margin-top:0%;");
          kbaIndicatorDiv.innerHTML = "KBA Not Detected";
        }
        kbaCheckDiv.appendChild(kbaIndicatorDiv);
        pulseCheckerDiv.appendChild(kbaCheckDiv);
      }else{
        //Compact version
        if(kbaAddBalace > 0){
          kbaCheckDiv.setAttribute("style","margin-left:10px; line-height:38px; vertical-align:-3px; display:inline-block; background-color: PaleGreen; width:25px; height:25px; border-radius:13px;");
          kbaCheckDiv.setAttribute("title","KBA Detected");
          kbaCheckDiv.innerHTML="<h3 style=\"text-align:center; vertical-align:top; color:white;\" title=\"KBA Detected\">K</h3>";
        }else{
          kbaCheckDiv.setAttribute("style","margin-left:10px; line-height:38px; vertical-align:-3px; display:inline-block; background-color: LightCoral; width:25px; height:25px; border-radius:13px;");
          kbaCheckDiv.setAttribute("title","No KBA Detected");
          kbaCheckDiv.innerHTML="<h3 style=\"text-align:center; vertical-align:top; color:white;\" title=\"No KBA Detected\">K</h3>";
        }
        pulseCheckerDiv.appendChild(kbaCheckDiv);
      }
    }catch(err){
      //exception seems to be triggered when there is a corrupt memo coming from SNow. If this is the case, state the error and clear the KBA CSM Insights
      kbaCsmInsights = [];
      var kbaCheckDiv = document.createElement("div");
      if(!isCompactVersionActive){
        //Full version
        kbaCheckDiv.setAttribute("style","text-align: center; color: white;");
        kbaCheckDiv.innerHTML = "<h3 style=\"margin-bottom:0%;\">KBA</h3>";
        var kbaIndicatorDiv = document.createElement("h4");
        isKbaAttached = true;
        kbaIndicatorDiv.setAttribute("style","color: Khaki; margin-top:0%;");
        kbaIndicatorDiv.innerHTML = "Error detecting KBA";
        
        kbaCheckDiv.appendChild(kbaIndicatorDiv);
        pulseCheckerDiv.appendChild(kbaCheckDiv);
      }else{
        //Compact version
        kbaCheckDiv.setAttribute("style","margin-left:10px; line-height:38px; vertical-align:-3px; display:inline-block; background-color: Khaki; width:25px; height:25px; border-radius:13px;");
        kbaCheckDiv.setAttribute("title","KBA Detected");
        kbaCheckDiv.innerHTML="<h3 style=\"text-align:center; vertical-align:top; color:white;\" title=\"Error detecting KBA\">K</h3>";
        
        pulseCheckerDiv.appendChild(kbaCheckDiv);
      }
    }
            
      //Add result KCS status check and CSM Insights
      var csmInsightsDiv = document.createElement("h2");
      if(!isCompactVersionActive){
        //Full version
        csmInsightsDiv.setAttribute("style","text-align: center; color: white; margin-top:-1%;");
        if(pulseCsmInsights.length>0 || kbaCsmInsights.length>0 || otherCsmInsights.length>0 || aiCsmInsights.length>0){
          //if pulse is showing as not required, the position of the Insights buttons is shifted up. This reajusts the position of the notification circle
          var insightNotificationTopPositionOffset = (receivedCaseData.headers.data.resolutionError.category == "service_request")?"310px;":"355px;";
          csmInsightsDiv.innerHTML = "<button style=\"cursor:pointer; align-items: center; padding: 6px 30px; border-radius: 3px; border: none; background: rgb(20, 125, 237); box-shadow: 0px 0.5px 1px rgba(0, 0, 0, 0.1); color: #DFDEDF;\" id=\"insights\"><h3 style=\"margin:0%; padding:0%;\" id=\"insightsText\">🛈 CSM Insights 🛈</h3><div style=\"width:16px; heigth:20px; border-radius:12px; background-color:red; position:absolute; top:"+insightNotificationTopPositionOffset+" left:205px; padding:2px;\">+</div></button>";
        }else{
          csmInsightsDiv.innerHTML = "<button style=\"align-items: center; padding: 6px 30px; border-radius: 3px; border: none; background: rgb(178, 179, 182); box-shadow: 0px 0.5px 1px rgba(0, 0, 0, 0.1); color: #DFDEDF;\" id=\"insights\"><h3 style=\"margin:0%; padding:0%;\" id=\"insightsText\">🛈 CSM Insights 🛈</h3></button>";
        } 
      }else{
        //Compact Version
        csmInsightsDiv.setAttribute("style","margin-left:10px; margin-top: -6px; vertical-align:middle; display:inline-block;");
        csmInsightsDiv.setAttribute("title","CSM Insights");
        if(pulseCsmInsights.length>0 || kbaCsmInsights.length>0 || otherCsmInsights.length>0 || aiCsmInsights.length>0){
          csmInsightsDiv.innerHTML = "<button style=\"cursor:pointer; align-items: center; vertical-align:top; margin-top:0px; padding: 6px 10px; border-radius: 20px; border: none; background: rgb(20, 125, 237); box-shadow: 0px 0.5px 1px rgba(0, 0, 0, 0.1); color: #DFDEDF;\" id=\"insights\" title=\"CSM Insights\"><h3 title=\"KCS Insights\" style=\"margin:0%; padding:0%;\" id=\"insightsText\">🛈</h3><div style=\"width:16px; heigth:10px; border-radius:12px; background-color:red; position:absolute; top:4px; left:300px; padding:2px;\">+</div></button>";
        }else{
          csmInsightsDiv.innerHTML = "<button style=\"align-items: center; vertical-align:top; margin-top:0px; padding: 6px 10px; border-radius: 20px; border: none; background: rgb(178, 179, 182); box-shadow: 0px 0.5px 1px rgba(0, 0, 0, 0.1); color: #DFDEDF;\" id=\"insights\"><h3 style=\"margin:0%; padding:0%;\" id=\"insightsText\">🛈</h3></button>";
        }
      }

      pulseCheckerDiv.appendChild(csmInsightsDiv);
        
      });
    }catch(err){
      console.log("exception: "+err);
    }

    
    document.body.appendChild(pulseCheckerDiv);
  }
  

  function verifyCategorizeSection(pulse){
    let counter = 0;
    kcsCategorizeComplete = false;
    if(pulse == "New"){
      throw new Error("Pulse is initial");
    }else{
      if(trimPulseField(pulse.symptom).length > 2){
        counter++;
        //According to KCS, pulse needs at least the symptom to be considered complete
        kcsCategorizeComplete = true;
      }
      if(trimPulseField(pulse.environment).length > 2){
        counter++;
      }
      if(trimPulseField(pulse.steps_to_reproduce).length > 2){
        counter++;
      }
      if(trimPulseField(pulse.business_impact).length > 2){
        counter++;
      }
      if(trimPulseField(pulse.customer_contacts).length > 2){
        counter++;
      }

      return counter;
    }
  }

  function verifyInvestigateSection(pulse){
    let counter = 0;
    kcsInvestigateComplete = false;
    if(pulse == "New"){
      throw new Error("Pulse is initial");
    }else{
      if(trimPulseField(pulse.data_collected).length > 2){
        counter++;
      }
      if(trimPulseField(pulse.research).length > 2){
        counter++;
      }
      if(trimPulseField(pulse.research_internal).length > 2){
        counter++;
      }

      //According to KCS, pulse needs at least 1 field complete for Investigate and Diagnose
      if(counter > 0){
        kcsInvestigateComplete = true;
      }
      return counter;
    }
  }

  function verifyResolutionSection(pulse){
    let counter = 0;
    if(pulse == "New"){
      throw new Error("Pulse is initial");
    }else{
      if(trimPulseField(pulse.cause).length > 2){
        counter++;
      }
      if(trimPulseField(pulse.solution).length > 2){
        counter++;
      }
      if(trimPulseField(pulse.see_also).length > 2){
        counter++;
      }
      if(trimPulseField(pulse.internal_memo_html).length > 2){
        counter++;
      }

      return counter;
    }
  }

  function trimPulseField(fieldData){
    let trimmedValue = fieldData.substring(3);
    trimmedValue = trimmedValue.substring(0,(trimmedValue.length-4));
    return trimmedValue;
  }

  const resizeObserver = new ResizeObserver(() => {
    adjustPositionAfterResize();
  });

  resizeObserver.observe(document.body);
