package io.github.jh133a11y.sangki;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final String HOME = "https://jh133-a11y.github.io/sangki/";
    private static final int PICK_FILE = 10;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private boolean resumed;

    private final Runnable update = new Runnable() {
        @Override public void run() {
            if (!resumed) return;
            if (isSite(webView.getUrl())) {
                webView.evaluateJavascript(
                    "window.sangkiNativeState && window.sangkiNativeState("
                    + PlaybackService.snapshot() + ")", null);
            }
            handler.postDelayed(this, 500);
        }
    };

    static boolean isSite(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        return "https".equals(uri.getScheme())
            && "jh133-a11y.github.io".equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443)
            && uri.getPath() != null && uri.getPath().startsWith("/sangki/");
    }

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        webView.setBackgroundColor(0xfff1eee7);
        webView.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(webView);
        webView.requestApplyInsets();
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(true);
        webView.getSettings().setSupportMultipleWindows(true);
        webView.getSettings().setJavaScriptCanOpenWindowsAutomatically(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(true);
        webView.addJavascriptInterface(new Bridge(), "SangkiAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return !isSite(request.getUrl().toString());
                return navigate(request.getUrl().toString());
            }
            @Override public void onReceivedError(WebView view, android.webkit.WebResourceRequest request,
                    android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) {
                    new AlertDialog.Builder(MainActivity.this)
                        .setMessage("사이트를 불러오지 못했습니다. 인터넷 연결을 확인하세요.")
                        .setPositiveButton("다시 시도", (dialog, which) -> webView.loadUrl(HOME))
                        .setNegativeButton("닫기", null).show();
                }
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent picker = params.createIntent();
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                try {
                    startActivityForResult(picker, PICK_FILE);
                } catch (ActivityNotFoundException error) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "파일 선택 앱을 찾을 수 없습니다.", Toast.LENGTH_LONG).show();
                }
                return true;
            }
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                    .setPositiveButton("확인", (dialog, which) -> result.confirm())
                    .setNegativeButton("취소", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture,
                    android.os.Message message) {
                if (!userGesture) return false;
                WebView child = new WebView(MainActivity.this);
                child.setWebViewClient(new WebViewClient() {
                    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                        String url = request.getUrl().toString();
                        if (!navigate(url)) webView.loadUrl(url);
                        child.destroy();
                        return true;
                    }
                });
                ((WebView.WebViewTransport) message.obj).setWebView(child);
                message.sendToTarget();
                return true;
            }
        });
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(HOME);
        }
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 11);
        }
    }

    private boolean navigate(String url) {
        if (isSite(url)) return false;
        String scheme = Uri.parse(url).getScheme();
        if ("https".equals(scheme) || "http".equals(scheme) || "mailto".equals(scheme)) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (ActivityNotFoundException error) {
                Toast.makeText(this, "링크를 열 수 있는 앱이 없습니다.", Toast.LENGTH_LONG).show();
            }
        } else {
            Toast.makeText(this, "지원하지 않는 링크입니다.", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private class Bridge {
        @JavascriptInterface public String state() { return PlaybackService.snapshot(); }
        @JavascriptInterface public void command(String json) {
            handler.post(() -> {
                if (!resumed || !isSite(webView.getUrl())) return;
                try {
                    JSONObject value = new JSONObject(json);
                    String action = value.getString("action");
                    if (!PlaybackService.validAction(action)) throw new IllegalArgumentException("Unknown action");
                    if (!"queue".equals(action)
                            && new JSONObject(PlaybackService.snapshot()).getJSONArray("queue").length() == 0) {
                        return;
                    }
                    Intent intent = new Intent(MainActivity.this, PlaybackService.class);
                    intent.setAction(action);
                    intent.putExtra("payload", json);
                    startForegroundService(intent);
                } catch (Exception error) {
                    Toast.makeText(MainActivity.this, "재생 요청에 실패했습니다: " + error.getMessage(),
                        Toast.LENGTH_LONG).show();
                }
            });
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        }
    }
    @Override protected void onSaveInstanceState(Bundle out) {
        webView.saveState(out);
        super.onSaveInstanceState(out);
    }
    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        webView.onResume();
        handler.post(update);
    }
    @Override protected void onPause() {
        resumed = false;
        handler.removeCallbacks(update);
        webView.onPause();
        super.onPause();
    }
    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else moveTaskToBack(true);
    }
    @Override protected void onDestroy() {
        handler.removeCallbacks(update);
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        webView.removeJavascriptInterface("SangkiAndroid");
        webView.destroy();
        super.onDestroy();
    }
}
