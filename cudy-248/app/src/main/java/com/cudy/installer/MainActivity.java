package com.cudy.installer;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceResponse;
import java.io.InputStream;

public class MainActivity extends Activity {
 private WebView webView;
 private CudyUpdater updater;
 private ValueCallback<Uri[]> fileCallback;
 private static final int FILE_REQUEST = 248;
 @Override protected void onCreate(Bundle state) {
  super.onCreate(state);
  getWindow().setStatusBarColor(Color.rgb(16,33,60));
  getWindow().setNavigationBarColor(Color.rgb(16,33,60));
  webView = new WebView(this);
  webView.setBackgroundColor(Color.rgb(243,246,250));
  webView.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.MATCH_PARENT));
  WebSettings s=webView.getSettings(); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setAllowFileAccess(false); s.setSupportZoom(false); s.setUseWideViewPort(true); s.setLoadWithOverviewMode(true);
  webView.setWebChromeClient(new WebChromeClient(){
   @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
    if(fileCallback!=null) fileCallback.onReceiveValue(null);
    fileCallback=callback;
    Intent choose=new Intent(Intent.ACTION_OPEN_DOCUMENT);
    choose.addCategory(Intent.CATEGORY_OPENABLE);
    choose.setType("*/*");
    choose.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/json","text/plain","application/octet-stream"});
    try { startActivityForResult(choose,FILE_REQUEST); }
    catch(Exception e) { fileCallback.onReceiveValue(null); fileCallback=null; }
    return true;
   }
  });
  updater=new CudyUpdater(this,webView);
  webView.addJavascriptInterface(updater,"CudyUpdater");
  webView.setWebViewClient(new WebViewClient(){
   @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
    Uri uri=request.getUrl();
    if(!"cudy-app.invalid".equals(uri.getHost())||!"https".equals(uri.getScheme()))return null;
    String path=uri.getPath();
    if(path==null||!path.startsWith("/")||path.contains(".."))return null;
    try{
     String name=path.substring(1);
     if(name.isEmpty())name="Cudy_Installer_MiniApp.html";
     InputStream stream=getAssets().open(name);
     String mime=name.endsWith(".html")?"text/html":name.endsWith(".js")?"text/javascript":name.endsWith(".css")?"text/css":name.endsWith(".webp")?"image/webp":"application/octet-stream";
     return new WebResourceResponse(mime,name.endsWith(".webp")?null:"UTF-8",stream);
    }catch(Exception ignored){return null;}
   }
   @Override public void onPageFinished(WebView view,String url){super.onPageFinished(view,url);if(updater!=null)updater.checkOnLaunch();}
   @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r){return route(r.getUrl());}
   @SuppressWarnings("deprecation") @Override public boolean shouldOverrideUrlLoading(WebView v,String u){return route(Uri.parse(u));}
   private boolean route(Uri uri){String scheme=uri.getScheme(); if("cudy-app.invalid".equals(uri.getHost())&&"https".equalsIgnoreCase(scheme))return false; if("https".equalsIgnoreCase(scheme)||"http".equalsIgnoreCase(scheme)){try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){}} return true;}
  });
  setContentView(webView);
  webView.loadUrl("https://cudy-app.invalid/Cudy_Installer_MiniApp.html");
 }
 @Override protected void onActivityResult(int requestCode,int resultCode,Intent result){
  super.onActivityResult(requestCode,resultCode,result);
  if(requestCode==FILE_REQUEST&&fileCallback!=null){
   Uri uri=resultCode==RESULT_OK&&result!=null?result.getData():null;
   fileCallback.onReceiveValue(uri==null?null:new Uri[]{uri});fileCallback=null;
  }
 }
 @Override protected void onSaveInstanceState(Bundle state){if(webView!=null)webView.saveState(state);super.onSaveInstanceState(state);}
 @Override public void onBackPressed(){if(webView!=null){webView.evaluateJavascript("window.appBack ? window.appBack() : false",value->{if(!"true".equals(value))super.onBackPressed();});}else super.onBackPressed();}
 @Override protected void onDestroy(){if(fileCallback!=null){fileCallback.onReceiveValue(null);fileCallback=null;}if(updater!=null){updater.shutdown();updater=null;}if(webView!=null){webView.stopLoading();webView.destroy();webView=null;}super.onDestroy();}
}
