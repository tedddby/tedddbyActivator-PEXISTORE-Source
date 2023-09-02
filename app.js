const express = require("express"); const app = express();
const jwt = require("jsonwebtoken");
const env = require("dotenv");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const request = require("request");
env.config({path:"./sec.env"});
const envData = process.env;
const stripe = require("stripe")(envData.Stripe_SK);
const WebhookSecret = envData.WebhookSecret;
const hbs = require("hbs");
const path = require("path");
const { Webhook, MessageBuilder } = require('discord-webhook-node');

app.set("view engine", "hbs");
app.use(express.static(path.join(__dirname, 'public')));

const promisify = f => (...args) => new Promise((a,b)=>f(...args, (err, res) => err ? b(err) : a(res)));


const webhook = async (req, res) =>
{

    const payload = req.body;
    const sig = req.headers['stripe-signature'];
  
    let event;
  
    try {
      event = stripe.webhooks.constructEvent(payload, sig, WebhookSecret);
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  
    if(event.type === 'checkout.session.completed') {
        const session = event.data.object;
        if(session.success_url.includes("pexistore") == true){
            doPexiMagic(session);
        }else{
            if(session.success_url.includes("reselling") == false){
                ConfirmTransaction(session);
            }else{
                ConfirmTransactionReseller(session);
            }
        }
    }

    res.status(200).json({
        received:true
    });
};

const sendRequest = async (url, auth) => {
    try{
        const request = await
        fetch(url, {
            method:"post",
            headers:{
                "Content-Type":"application/json",
                "authorization":auth
            }
        })
        .then(function(res){
            if(res.ok == true){
                return res.json();
            }else{
                return "500";
            }
        })
        .then(data => {
            if(data == "500"){
                return "500";
            }else{
                return data.data;
            }
        })
        return request;
    }catch{
        return "error";
    }
}

const doPexiMagic = async (session) => {
    if(session.payment_status === 'paid'){
        const intent = await stripe.paymentIntents.retrieve(session.payment_intent);
        const price = intent.amount_received/100;
        const email = session.customer_details.email;

        var embed = new MessageBuilder()
        .setTitle(`[PEXISTORE]: New Payment Received`)
        .addField('Customer Email', `${email}`)
        .addField('AMOUNT RECEIVED', `${price}`)
        .setColor("#00FF00")
        .setTimestamp();
        new Webhook("https://discord.com/api/webhooks/883461666996625490/54YR8oeetR-iunMVXf3WoapuBq8HpnzScJ3lDpshsWBySDjAXJKE6-EbbaLBTc-1R4qW").send(embed);
        return true;
    }else{
        return false;
    }
}

const ConfirmTransaction = async (session) => {

    if(session.payment_status === 'paid'){

        const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent); //.amount //.amount_received
        const successUrl = session.success_url;
        const token = successUrl.split("?")[1].split("=")[1];
        try{
            const decoded = await promisify(jwt.verify)(token, envData.JWT_Private_Key);
            const price = decoded.Price;
            var accessToken;

            if(decoded.SoldBy){
                accessToken = jwt.sign({
                    SerialNumber:decoded.SerialNumber,
                    Service:decoded.Service,
                    Email:session.customer_details.email,
                    Amount:paymentIntent.amount_received/100,
                    SoldBy:decoded.SoldBy
                }, envData.JWT_Private_Key, {expiresIn: 15 * 60 * 1000});
            }else{
                accessToken = jwt.sign({
                    SerialNumber:decoded.SerialNumber,
                    Service:decoded.Service,
                    Email:session.customer_details.email,
                    Amount:paymentIntent.amount_received/100
                }, envData.JWT_Private_Key, {expiresIn: 15 * 60 * 1000});
            }

            if(paymentIntent.amount_received/100 == price){
                /**/ console.log("price ok")
                const lowered = decoded.Service.split(" ")[0].toLowerCase(); //fmi
                const url = "https://api.v2.tedddby.com/"+lowered+"/register";

                let hitServer = "500";
        
                while(hitServer == "500"){
                    hitServer = await sendRequest(url, accessToken);
                }

                return true;

            }
        }catch{
            return false;
        }
    }
}

const ConfirmTransactionReseller = async (session) => {

    if(session.payment_status === 'paid'){

        try{
        const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent); //.amount //.amount_received
        const successUrl = session.success_url;
        const userID = successUrl.split("/")[4];
        const credits = paymentIntent.amount_received/100;
        const email = session.customer_details.email;

        const authorization = jwt.sign({
            userID:userID,
            credits:credits,
            email:email,
            amount:credits
        }, envData.JWT_Private_Key, {
            expiresIn:"1h"
        });

        const resellerUrl = "https://api.v2.tedddby.com/reseller/credits/add";
        let sent = "500";
        
        while(sent == "500"){
            sent = await sendRequest(resellerUrl, authorization);
        }

        return true;

        }catch{
            return false;
        }
        
    }
}

app.post("/webhook", bodyParser.raw({type: 'application/json'}), webhook);

app.get("/", (req, res) => {
    res.render("index.hbs");
})

app.post("/e/s/new", bodyParser.raw({type: 'application/json'}), (req, res) => {
    const body = JSON.parse(req.body.toString());
    if(body.email.length <= 0){
        return res.json({
            status:false,
            message:"No Email Provided"
        })
    }else{
        return res.json({
            status:true,
            message:`${body.email} successfully subscribed!`
        })
    }
})

app.post("/s/s/new", bodyParser.raw({type: 'application/json'}), async (req, res) => {
    const body = JSON.parse(req.body.toString());
    if(body.service.length > 0){
        var secureCode = body.secureCode;
        var email = body.email;

        var service;
        var price;
        if(body.service == "shared-hosting"){
            service = "Shared Hosting"
            price = 5.99
        }else{
            if(body.service == "vps-hosting"){
                service = "VPS Hosting"
                price = 15
            }else{
                return res.json({
                    status:false,
                    message:"unknnow service"
                })
            }
        }

        price = price*100;

        const options = {
            payment_method_types: ["card"],
            line_items: [
                {
                    price_data: {
                        currency: "usd",
                        product_data: {
                            name: "Activation",
                            description:service+" For "+email+". Order ID: "+secureCode
                        },
                        unit_amount: price,
                    },
                    quantity: 1,
                },
            ],
            mode: "payment",
            success_url: `https://pexistore.com?status=success&email=`+email,
            cancel_url: `https://pexistore.com?status=cancelled`,
        }

        const session = await stripe.checkout.sessions.create(options);

        if(session.id){
            return res.json({
                status:true,
                message:session.id
            })
        }else{
            return res.json({
                status:false,
                message:"Internal Server Error"
            })
        }

    }else{
        return res.json({
            status:false,
            message:"Invalid Data"
        })
    }
})

app.get("*" , (req, res) => {
    return res.send("- 404 -")
})

app.listen(3607, (e) => {
    if (e) console.error(e);
    else console.log("SERVER UP!")
})
